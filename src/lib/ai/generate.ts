import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import type { Prospect } from "@/lib/sheets/mapping";
import { alreadyOnLinkedin } from "@/lib/sheets/mapping";
import type { AppSettings } from "@/lib/settings-defaults";
import type { Campaign, Draft, ResearchPack } from "@/lib/types";
import { packText } from "@/lib/research/firecrawl";
import { validate, type ValidationResult } from "@/lib/validator";
import { geminiStructured, geminiModelInUse } from "./gemini";

const DraftSchema = z.object({
  research_summary: z.string().describe("2-3 plain sentences about what they sell and to whom"),
  hook: z.string().describe("1 sentence, a specific true fact about them from the research pack"),
  hook_source_url: z.string().describe("copied exactly from one of the research pack URLs"),
  challenge_idea: z.string().describe("1 sentence: a contest challenge built on their named product"),
  email_subject: z.string().describe("max 60 characters, no Re:"),
  email_body: z.string().describe("plain text, max 190 words before the signature, ends with {{SENDER_SIGNATURE}}"),
  linkedin_note: z.string().describe("max 280 characters, from Pratham, no links"),
  x_dm: z.string().describe("max 280 characters including the deck link, from Pratham"),
  confidence: z.enum(["high", "medium", "low"]),
  flags: z.array(z.string()),
});

const GATEWAY_URL = "https://ai-gateway.vercel.sh";

/** Which writer is used: Anthropic (ANTHROPIC_API_KEY) > Gemini free tier (GEMINI_API_KEY) > Vercel AI Gateway. */
export function provider(): "anthropic" | "gemini" | "gateway" {
  if (process.env.ANTHROPIC_API_KEY) return "anthropic";
  if (process.env.GEMINI_API_KEY) return "gemini";
  return "gateway";
}

export function usingGateway(): boolean {
  return provider() === "gateway";
}

let _direct: Anthropic | null = null;
async function client(): Promise<Anthropic> {
  if (!usingGateway()) {
    _direct ??= new Anthropic();
    return _direct;
  }
  let token = process.env.AI_GATEWAY_API_KEY;
  if (!token) {
    // OIDC tokens are short-lived, so fetch per call (cheap; the helper caches and refreshes).
    const { getVercelOidcToken } = await import("@vercel/oidc");
    token = await getVercelOidcToken();
  }
  return new Anthropic({ apiKey: token, baseURL: GATEWAY_URL });
}

/** Model id from CLAUDE_MODEL. AI Gateway ids look like "anthropic/claude-sonnet-5.5". */
export function model(): string {
  if (provider() === "gemini") return geminiModelInUse();
  const m = process.env.CLAUDE_MODEL || "claude-sonnet-5-5";
  if (!usingGateway()) return m.replace(/^anthropic\//, "").replace(/(\d)\.(\d)/, "$1-$2");
  if (m.includes("/")) return m;
  return `anthropic/${m.replace(/-(\d+)-(\d+)$/, "-$1.$2")}`;
}

function systemBlocks(s: AppSettings): Anthropic.TextBlockParam[] {
  // Stable across rows, so it is cached after the first call in a run.
  const text = `${s.systemPrompt}

EMAIL TEMPLATE for campaign "Fresh pitch":
${s.emailTemplateFirst}

EMAIL TEMPLATE for campaign "Re-engage":
${s.emailTemplateReengage}

LINKEDIN NOTE:
${s.linkedinTemplate}

X DM:
${s.xTemplate}

Deck link (use exactly this URL, once in the email and once in the X DM): ${s.deckLink}`;
  return [{ type: "text", text, cache_control: { type: "ephemeral" } }];
}

function packForPrompt(pack: ResearchPack) {
  return {
    company: pack.company,
    website: pack.website,
    category_note_from_our_sheet: pack.categoryReason,
    homepage: pack.homepageUrl ? { url: pack.homepageUrl, content: pack.homepageSummary } : null,
    other_pages: pack.extraPages.map((e) => ({ url: e.url, title: e.title, content: e.markdown })),
    recent_items: pack.recent,
    docs_url: pack.docsUrl ?? null,
    allowed_source_urls: pack.urls,
    research_flags: pack.flags,
  };
}

function rowForPrompt(p: Prospect, campaign: Campaign) {
  return {
    first_name: p.firstName,
    last_name: p.lastName,
    title: p.title,
    company: p.company,
    department: p.department,
    campaign,
    pratham_already_contacted_on_linkedin: alreadyOnLinkedin(p),
  };
}

/** Deterministic clean-up for things the model sometimes slips on. */
export function tidy(d: Draft): Draft {
  const fix = (s: string) =>
    s
      .replace(/\s*—\s*/g, ", ")
      .replace(/(\D)\s*–\s*(\D)/g, "$1, $2")
      .replace(/[ \t]+\n/g, "\n")
      .trim();
  return {
    ...d,
    hook: fix(d.hook),
    challenge_idea: fix(d.challenge_idea),
    research_summary: fix(d.research_summary),
    email_subject: fix(d.email_subject).replace(/^\s*(re|fwd?)\s*:\s*/i, ""),
    email_body: fix(d.email_body),
    linkedin_note: fix(d.linkedin_note),
    x_dm: fix(d.x_dm),
  };
}

async function call(s: AppSettings, userContent: string): Promise<Draft> {
  if (provider() === "gemini") {
    return geminiStructured(systemBlocks(s).map((b) => b.text).join("\n"), userContent, DraftSchema);
  }
  const res = await (await client()).messages.parse({
    model: model(),
    max_tokens: 16000,
    system: systemBlocks(s),
    output_config: { effort: "medium", format: zodOutputFormat(DraftSchema) },
    messages: [{ role: "user", content: userContent }],
  });
  if (res.stop_reason === "refusal") throw new Error("Model declined to write this draft");
  if (res.stop_reason === "max_tokens") throw new Error("Model output was cut off (max_tokens)");
  if (!res.parsed_output) throw new Error("Model returned output that didn't match the draft schema");
  return res.parsed_output;
}

export function validateDraft(d: Draft, p: Prospect, pack: ResearchPack, s: AppSettings): ValidationResult {
  return validate(
    {
      firstName: p.firstName,
      email_subject: d.email_subject,
      email_body: d.email_body,
      linkedin_note: d.linkedin_note,
      x_dm: d.x_dm,
      hook: d.hook,
      challenge_idea: d.challenge_idea,
      hook_source_url: d.hook_source_url,
      confidence: d.confidence,
      modelFlags: [...new Set([...d.flags, ...pack.flags])],
    },
    { deckLink: s.deckLink, packUrls: pack.urls, packText: packText(pack), personXFound: !!pack.personX },
  );
}

function basePrompt(p: Prospect, pack: ResearchPack, campaign: Campaign) {
  return `Write the outreach for this prospect.

PROSPECT:
${JSON.stringify(rowForPrompt(p, campaign), null, 2)}

RESEARCH PACK (the only source of facts about them):
${JSON.stringify(packForPrompt(pack), null, 2)}`;
}

export interface DraftResult {
  draft: Draft;
  validation: ValidationResult;
  attempts: number;
}

/** First draft (or a regenerate with the reviewer's instruction). One model call. */
export async function firstDraft(
  p: Prospect,
  pack: ResearchPack,
  campaign: Campaign,
  s: AppSettings,
  opts?: { previous?: Draft; instruction?: string },
): Promise<DraftResult> {
  const base = basePrompt(p, pack, campaign);
  const prompt = opts?.previous
    ? `${base}

PREVIOUS DRAFT:
${JSON.stringify(opts.previous, null, 2)}

REVIEWER INSTRUCTION (apply it, keep everything else that was good, and keep all the rules):
${opts.instruction || "Improve it."}`
    : base;
  const draft = tidy(await call(s, prompt));
  return { draft, validation: validateDraft(draft, p, pack, s), attempts: 1 };
}

/** One repair call that fixes exactly the failed checks. */
export async function fixDraft(p: Prospect, pack: ResearchPack, campaign: Campaign, s: AppSettings, prev: DraftResult): Promise<DraftResult> {
  const fixPrompt = `${basePrompt(p, pack, campaign)}

YOUR DRAFT:
${JSON.stringify(prev.draft, null, 2)}

It failed these checks. Fix only these problems and return the full corrected draft:
${prev.validation.hard.map((h) => `- ${h}`).join("\n")}

Reminders: linkedin_note and x_dm max 280 characters each (count them), subject max 60 characters, email body max 190 words before {{SENDER_SIGNATURE}}, greeting must be "Hi ${p.firstName},", the email must contain ${s.deckLink}, hook_source_url must be one of allowed_source_urls exactly, no numbers except 52,000, 50,000+, 1M+, 1,300+, 1,000+, 30, 20, 2 to 4 and numbers that appear in the research pack.`;
  const draft = tidy(await call(s, fixPrompt));
  return { draft, validation: validateDraft(draft, p, pack, s), attempts: prev.attempts + 1 };
}

/** Draft + (if needed) one fix pass. Used by Regenerate and the preview script. */
export async function generateDraft(
  p: Prospect,
  pack: ResearchPack,
  campaign: Campaign,
  s: AppSettings,
  opts?: { previous?: Draft; instruction?: string },
): Promise<DraftResult> {
  const first = await firstDraft(p, pack, campaign, s, opts);
  return first.validation.ok ? first : fixDraft(p, pack, campaign, s, first);
}
