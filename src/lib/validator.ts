// Rule checks (spec section 7). Runs after every generation and every manual edit.

export interface ValidationInput {
  firstName: string;
  email_subject: string;
  email_body: string;
  linkedin_note: string;
  x_dm: string;
  hook?: string;
  challenge_idea?: string;
  hook_source_url?: string;
  confidence?: string;
  modelFlags?: string[];
}

export interface ValidationContext {
  deckLink: string;
  packUrls: string[]; // URLs in the ResearchPack
  packText: string; // all ResearchPack text, used to allow numbers that appear in it
  personXFound: boolean;
}

export interface ValidationResult {
  hard: string[];
  soft: string[];
  ok: boolean;
}

export const LIMITS = { linkedin: 280, x: 280, subject: 60, bodyWords: 160 };

export const BANNED = [
  "unlock",
  "supercharge",
  "game-changing",
  "game changer",
  "game-changer",
  "seamless",
  "seamlessly",
  "revolutionize",
  "revolutionise",
  "leverage",
  "synergy",
  "cutting-edge",
  "cutting edge",
  "excited to",
  "hope this finds you well",
];

export const HIRING = ["hire", "hires", "hiring", "recruit", "recruits", "recruiting", "recruiter", "candidates", "candidate", "talent pipeline", "screening"];

// Numbers from the approved deck, plus the deck's own timeline numbers (1 week setup,
// 2 to 4 week contest). Anything else must appear in the ResearchPack.
const ALLOWED_NUMBERS = ["50,000+", "50,000", "1M+", "1M", "1,300+", "1,300", "1,000+", "1,000", "30", "20", "1", "2", "3", "4"];

export const SIGNATURE_TOKEN = "{{SENDER_SIGNATURE}}";

export function charCount(s: string): number {
  return [...s].length;
}

export function bodyWordCount(body: string): number {
  const withoutSig = body.split(SIGNATURE_TOKEN)[0];
  return withoutSig.split(/\s+/).filter((w) => w && !/^https?:\/\//.test(w)).length;
}

function hasPhrase(text: string, phrase: string): boolean {
  const esc = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
  return new RegExp(`(^|[^a-z])${esc}([^a-z]|$)`, "i").test(text);
}

function canonNumber(n: string): string {
  return n.replace(/,/g, "").replace(/\+$/, "").toLowerCase();
}

/** Extract number tokens, ignoring the ones inside URLs. */
export function extractNumbers(text: string): string[] {
  const noUrls = text.replace(/https?:\/\/\S+/g, " ").replace(/\{\{SENDER_SIGNATURE\}\}/g, " ");
  const matches = noUrls.match(/\d[\d,]*(?:\.\d+)?(?:[kKmMbB](?![a-zA-Z]))?\+?/g) ?? [];
  return matches
    .map((m) => m.replace(/,+$/, ""))
    .filter((m) => /\d/.test(m));
}

export function dashProblems(text: string): boolean {
  if (text.includes("—")) return true; // em dash
  // en dash used as a dash: anything except a digit range like 2–4
  return /(^|[^\d])–|–([^\d]|$)/.test(text);
}

export function validate(input: ValidationInput, ctx: ValidationContext): ValidationResult {
  const hard: string[] = [];
  const soft: string[] = [];

  if (charCount(input.linkedin_note) > LIMITS.linkedin)
    hard.push(`linkedin_too_long (${charCount(input.linkedin_note)}/${LIMITS.linkedin})`);
  if (charCount(input.x_dm) > LIMITS.x) hard.push(`x_dm_too_long (${charCount(input.x_dm)}/${LIMITS.x})`);
  if (charCount(input.email_subject) > LIMITS.subject)
    hard.push(`subject_too_long (${charCount(input.email_subject)}/${LIMITS.subject})`);
  const words = bodyWordCount(input.email_body);
  if (words > LIMITS.bodyWords) hard.push(`email_too_long (${words}/${LIMITS.bodyWords} words)`);
  if (!input.email_subject.trim()) hard.push("subject_empty");
  if (/^\s*(re|fwd?)\s*:/i.test(input.email_subject)) hard.push("fake_reply_subject");

  if (input.hook_source_url !== undefined) {
    const norm = (u: string) => u.trim().replace(/\/+$/, "").toLowerCase();
    if (!ctx.packUrls.map(norm).includes(norm(input.hook_source_url))) hard.push("hook_source_not_in_research");
  }

  const allText = [input.email_subject, input.email_body, input.linkedin_note, input.x_dm, input.hook ?? "", input.challenge_idea ?? ""].join("\n");

  if (dashProblems(allText)) hard.push("contains_dash");
  if (allText.includes("!")) hard.push("contains_exclamation");

  const banned = BANNED.filter((w) => hasPhrase(allText, w));
  if (banned.length) hard.push(`banned_words: ${[...new Set(banned)].join(", ")}`);

  const hiring = HIRING.filter((w) => hasPhrase(allText, w));
  if (hiring.length) hard.push(`hiring_language: ${[...new Set(hiring)].join(", ")}`);

  const packNumbers = new Set(extractNumbers(ctx.packText).map(canonNumber));
  const allowed = new Set(ALLOWED_NUMBERS.map(canonNumber));
  const unknown = extractNumbers(allText).filter((n) => {
    const c = canonNumber(n);
    return !allowed.has(c) && !packNumbers.has(c);
  });
  if (unknown.length) hard.push(`unverified_numbers: ${[...new Set(unknown)].join(", ")}`);

  if (!input.email_body.includes(ctx.deckLink)) hard.push("missing_deck_link");
  if (input.linkedin_note.match(/https?:\/\//)) hard.push("link_in_linkedin_note");

  const greeting = input.email_body.trim().split("\n")[0] ?? "";
  if (!input.firstName || !greeting.toLowerCase().includes(input.firstName.toLowerCase()))
    hard.push("first_name_not_in_greeting");

  if (!input.email_body.includes(SIGNATURE_TOKEN)) soft.push("no_signature_placeholder");
  if (input.confidence === "low") soft.push("low_confidence");
  for (const f of input.modelFlags ?? []) if (!soft.includes(f)) soft.push(f);
  if (!ctx.personXFound) soft.push("no_person_x_found");

  return { hard, soft, ok: hard.length === 0 };
}
