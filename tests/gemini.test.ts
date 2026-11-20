import { describe, expect, it, vi, afterEach } from "vitest";
import { z } from "zod";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

const ok = (obj: unknown) => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "```json\n" + JSON.stringify(obj) + "\n```" }] } }] }), { status: 200 });
const err = (status: number, message: string) => new Response(JSON.stringify({ error: { message } }), { status });

describe("gemini provider", () => {
  it("falls back to the next model when one isn't available, then validates JSON", async () => {
    process.env.GEMINI_API_KEY = "test";
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      calls.push(url);
      if (url.includes("gemini-3.8-flash")) return err(404, "model not found");
      return ok({ a: "hi" });
    }));
    const { geminiStructured, geminiModelInUse } = await import("@/lib/ai/gemini");
    const out = await geminiStructured("sys", "user", z.object({ a: z.string() }));
    expect(out).toEqual({ a: "hi" });
    expect(calls.length).toBe(2);
    expect(geminiModelInUse()).toBe("gemini-3.7-flash");
  });

  it("re-asks when the output doesn't match the schema", async () => {
    process.env.GEMINI_API_KEY = "test";
    let n = 0;
    vi.stubGlobal("fetch", vi.fn(async () => (++n === 1 ? ok({ wrong: 1 }) : ok({ a: "fixed" }))));
    const { geminiStructured } = await import("@/lib/ai/gemini");
    expect(await geminiStructured("s", "u", z.object({ a: z.string() }))).toEqual({ a: "fixed" });
  });

  it("surfaces auth errors immediately", async () => {
    process.env.GEMINI_API_KEY = "bad";
    vi.stubGlobal("fetch", vi.fn(async () => err(400, "API key not valid")));
    const { geminiStructured } = await import("@/lib/ai/gemini");
    await expect(geminiStructured("s", "u", z.object({ a: z.string() }))).rejects.toThrow(/API key not valid/);
  });
});
