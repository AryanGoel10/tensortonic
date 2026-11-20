// Google Gemini (free tier via an AI Studio key). Native generateContent API with JSON output.
import { z } from "zod";
import { RetryAfterError } from "inngest";

const BASE = "https://generativelanguage.googleapis.com/v1beta";

// Tried in order. The first that the key can use wins and is remembered for this process.
const DEFAULT_MODELS = ["gemini-3.8-flash", "gemini-3-flash", "gemini-2.5-flash"];
let workingModel: string | null = null;

export function geminiModels(): string[] {
  const configured = process.env.GEMINI_MODEL?.trim();
  return configured ? [configured, ...DEFAULT_MODELS.filter((m) => m !== configured)] : DEFAULT_MODELS;
}

export function geminiModelInUse(): string {
  return workingModel ?? geminiModels()[0];
}

class GeminiError extends Error {
  constructor(message: string, readonly status: number, readonly retryAfterMs?: number) {
    super(message);
  }
}

async function generate(model: string, system: string, user: string, jsonSchema: object): Promise<string> {
  const res = await fetch(`${BASE}/models/${model}:generateContent`, {
    signal: AbortSignal.timeout(90_000),
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY ?? "" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: `${user}\n\nReturn ONLY a JSON object matching this JSON Schema:\n${JSON.stringify(jsonSchema)}` }] }],
      generationConfig: { responseMimeType: "application/json", temperature: 0.6, maxOutputTokens: 8192 },
    }),
  });
  const json = (await res.json().catch(() => ({}))) as {
    candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] }; finishReason?: string }[];
    promptFeedback?: { blockReason?: string };
    error?: { message?: string; status?: string; details?: { retryDelay?: string }[] };
  };
  if (!res.ok) {
    const delay = json.error?.details?.find((d) => d.retryDelay)?.retryDelay;
    const ms = delay ? parseFloat(delay) * 1000 : undefined;
    throw new GeminiError(`Gemini ${res.status}: ${json.error?.message ?? res.statusText}`, res.status, ms);
  }
  if (json.promptFeedback?.blockReason) throw new Error(`Gemini blocked the request (${json.promptFeedback.blockReason})`);
  const cand = json.candidates?.[0];
  const text = (cand?.content?.parts ?? []).filter((p) => !p.thought).map((p) => p.text ?? "").join("");
  if (!text) throw new Error(`Gemini returned no text (finishReason ${cand?.finishReason ?? "unknown"})`);
  return text;
}

function parseJson(text: string): unknown {
  const t = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  return JSON.parse(t);
}

/** Call Gemini and validate the output against `schema`. Falls back across models; retries rate limits. */
export async function geminiStructured<T>(system: string, user: string, schema: z.ZodType<T>): Promise<T> {
  const jsonSchema = z.toJSONSchema(schema);
  const models = workingModel ? [workingModel] : geminiModels();
  let lastErr: unknown;
  for (const model of models) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const text = await generate(model, system, user, jsonSchema);
        const parsed = schema.safeParse(parseJson(text));
        if (!parsed.success) {
          lastErr = new Error(`Gemini output didn't match the draft schema: ${parsed.error.issues[0]?.message}`);
          continue; // ask again
        }
        workingModel = model;
        return parsed.data;
      } catch (err) {
        lastErr = err;
        if (err instanceof GeminiError) {
          // model not available to this key / no free quota on it: try the next model
          if (err.status === 404 || (err.status === 429 && /limit: 0|quota.*0/i.test(err.message)) || err.status === 403) break;
          if (err.status === 429 || err.status >= 500) {
            // Don't sleep inside the step (Vercel cuts requests at 5 minutes). One short wait,
            // then hand it back to Inngest to retry the step later.
            if (attempt === 0 && (err.retryAfterMs ?? 0) <= 10_000) {
              await new Promise((r) => setTimeout(r, err.retryAfterMs ?? 5_000));
              continue;
            }
            throw new RetryAfterError(`Gemini is rate-limiting (free tier). Will retry automatically. ${err.message}`, Math.max(err.retryAfterMs ?? 30_000, 20_000));
          }
          throw err;
        }
        if (err instanceof SyntaxError) continue; // bad JSON, ask again
        if (err instanceof Error && err.name === "TimeoutError") throw new Error(`Gemini didn't answer within 90 seconds (${model})`);
        throw err;
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("Gemini call failed");
}
