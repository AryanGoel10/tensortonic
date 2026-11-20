import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { writeRow, readRow } from "@/lib/sheets/client";
import type { AiColumn, Prospect } from "@/lib/sheets/mapping";
import type { AppSettings } from "@/lib/settings-defaults";
import type { Campaign, Draft, DraftStatus, ResearchPack } from "@/lib/types";
import { packText } from "@/lib/research/firecrawl";
import { validate, type ValidationResult } from "@/lib/validator";

export function formatFlags(v: ValidationResult): string {
  return [...v.hard.map((h) => `FAIL: ${h}`), ...v.soft].join("; ");
}

export function parseFlags(s: string | undefined): { hard: string[]; soft: string[] } {
  const parts = (s ?? "").split(";").map((x) => x.trim()).filter(Boolean);
  return {
    hard: parts.filter((p) => p.startsWith("FAIL:")).map((p) => p.slice(5).trim()),
    soft: parts.filter((p) => !p.startsWith("FAIL:")),
  };
}

export async function savePack(spreadsheetId: string, tab: string, rowKey: string, pack: ResearchPack, draft: Draft | null) {
  await db()
    .insert(schema.researchPacks)
    .values({ spreadsheetId, tab, rowKey, pack, draft, createdAt: new Date() })
    .onConflictDoUpdate({
      target: [schema.researchPacks.spreadsheetId, schema.researchPacks.tab, schema.researchPacks.rowKey],
      set: { pack, draft, createdAt: new Date() },
    });
}

export async function loadPack(spreadsheetId: string, tab: string, rowKey: string) {
  const [row] = await db()
    .select()
    .from(schema.researchPacks)
    .where(
      and(
        eq(schema.researchPacks.spreadsheetId, spreadsheetId),
        eq(schema.researchPacks.tab, tab),
        eq(schema.researchPacks.rowKey, rowKey),
      ),
    );
  return row ? { pack: row.pack as ResearchPack, draft: (row.draft as Draft | null) ?? null } : null;
}

export function draftToColumns(
  draft: Draft,
  pack: ResearchPack,
  v: ValidationResult,
  campaign: Campaign,
): Partial<Record<AiColumn, string>> {
  return {
    "AI Draft Status": (v.ok ? "Drafted" : "Needs review") satisfies DraftStatus,
    "AI Campaign": campaign,
    "AI Research Summary": draft.research_summary,
    "AI Sources": [`Hook source: ${draft.hook_source_url}`, ...pack.urls.filter((u) => u !== draft.hook_source_url)].join("\n"),
    "AI Hook": draft.hook,
    "AI Challenge Idea": draft.challenge_idea,
    "AI Email Subject": draft.email_subject,
    "AI Email Body": draft.email_body,
    "AI LinkedIn Note": draft.linkedin_note,
    "AI X DM": draft.x_dm,
    "AI Person X URL": pack.personX?.url ?? "",
    "AI X Confidence": pack.personX?.confidence ?? "",
    "AI Flags": formatFlags(v),
    "AI Last Run": new Date().toISOString(),
  };
}

export function hookSourceFromSources(sources: string | undefined): string | undefined {
  const first = (sources ?? "").split("\n")[0] ?? "";
  const m = first.match(/^Hook source:\s*(\S+)/);
  return m ? m[1] : undefined;
}

/** Validate whatever is currently in the row's AI columns (used after manual edits). */
export async function validateRow(p: Prospect, spreadsheetId: string, tab: string, s: AppSettings): Promise<ValidationResult> {
  const stored = await loadPack(spreadsheetId, tab, p.key);
  const pack = stored?.pack;
  return validate(
    {
      firstName: p.firstName,
      email_subject: p.ai["AI Email Subject"] ?? "",
      email_body: p.ai["AI Email Body"] ?? "",
      linkedin_note: p.ai["AI LinkedIn Note"] ?? "",
      x_dm: p.ai["AI X DM"] ?? "",
      hook: p.ai["AI Hook"],
      challenge_idea: p.ai["AI Challenge Idea"],
      hook_source_url: pack ? hookSourceFromSources(p.ai["AI Sources"]) : undefined,
      confidence: stored?.draft?.confidence,
      modelFlags: [...(stored?.draft?.flags ?? []), ...(pack?.flags ?? [])],
    },
    {
      deckLink: s.deckLink,
      packUrls: pack?.urls ?? [],
      packText: pack ? packText(pack) : "",
      personXFound: !!(p.ai["AI Person X URL"] ?? "").trim(),
    },
  );
}

export const EDITABLE: Record<string, AiColumn> = {
  subject: "AI Email Subject",
  body: "AI Email Body",
  linkedin: "AI LinkedIn Note",
  x: "AI X DM",
  xUrl: "AI Person X URL",
  hook: "AI Hook",
  challenge: "AI Challenge Idea",
};

/**
 * Apply a reviewer edit: write the field, re-read, re-validate, write flags.
 * Approved rows drop back to Drafted/Needs review if an edit breaks a rule.
 */
export async function applyEdit(
  spreadsheetId: string,
  tab: string,
  key: string,
  field: keyof typeof EDITABLE,
  value: string,
  s: AppSettings,
) {
  const col = EDITABLE[field];
  const extra: Partial<Record<AiColumn, string>> = {};
  if (field === "xUrl") extra["AI X Confidence"] = value.trim() ? "confirmed" : "";
  await writeRow(spreadsheetId, tab, key, { [col]: value, ...extra });
  const { prospect } = await readRow(spreadsheetId, tab, key);
  if (!prospect) throw new Error("Row disappeared after edit");
  const v = await validateRow(prospect, spreadsheetId, tab, s);
  const status = prospect.ai["AI Draft Status"] ?? "";
  const patch: Partial<Record<AiColumn, string>> = { "AI Flags": formatFlags(v) };
  if (["Drafted", "Needs review", "Approved"].includes(status)) {
    if (!v.ok) patch["AI Draft Status"] = "Needs review";
    else if (status === "Needs review") patch["AI Draft Status"] = "Drafted";
  }
  await writeRow(spreadsheetId, tab, key, patch);
  return { validation: v, status: patch["AI Draft Status"] ?? status };
}
