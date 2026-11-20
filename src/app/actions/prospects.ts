"use server";

import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { requireUser } from "@/auth";
import { db, schema } from "@/db";
import { readTab } from "@/lib/sheets/client";
import { inngest, EVENTS } from "@/inngest/client";
import { log } from "@/lib/activity";
import type { Campaign } from "@/lib/types";
import type { Prospect } from "@/lib/sheets/mapping";
import { CREDITS_PER_ROW_ESTIMATE } from "@/lib/research/firecrawl";
import { eligible } from "@/lib/eligibility";
import { getSettings } from "@/lib/settings";
import { contactHistory, type ContactHistory } from "@/lib/history";

export interface TabView {
  prospects: Prospect[];
  warnings: string[];
  canDraft: boolean;
  missingAi: string[];
  duplicateKeys: string[];
  excludedCompanies: string[];
  history: Record<string, ContactHistory>;
}

export async function loadTab(spreadsheetId: string, tab: string): Promise<TabView> {
  await requireUser();
  const { map, prospects } = await readTab(spreadsheetId, tab);
  const counts = new Map<string, number>();
  for (const p of prospects) counts.set(p.key, (counts.get(p.key) ?? 0) + 1);
  const s = await getSettings();
  const history = await contactHistory(prospects.map((p) => p.email), s.dedupeDays);
  return {
    prospects,
    excludedCompanies: s.excludedCompanies,
    history,
    warnings: map.warnings,
    canDraft: map.canDraft,
    missingAi: map.missingAi,
    duplicateKeys: [...counts].filter(([, n]) => n > 1).map(([k]) => k),
  };
}

export async function costEstimate(rows: number) {
  return {
    rows,
    creditsMin: rows * CREDITS_PER_ROW_ESTIMATE.min,
    creditsMax: rows * CREDITS_PER_ROW_ESTIMATE.max,
    claudeCalls: rows,
  };
}

export async function startRun(spreadsheetId: string, tab: string, keys: string[], campaign: Campaign) {
  const user = await requireUser();
  const { map, prospects } = await readTab(spreadsheetId, tab);
  if (!map.canDraft) throw new Error("This tab is missing Email or Company columns.");
  if (map.missingAi.length) throw new Error("AI columns are missing. Add them first.");
  const s = await getSettings();
  const byKey = new Map(prospects.map((p) => [p.key, p]));
  const history = await contactHistory(keys.map((k) => byKey.get(k)?.email ?? ""), s.dedupeDays);
  const rows = [...new Set(keys)].filter((k) => {
    const p = byKey.get(k);
    if (!p || !eligible(p, campaign, s.excludedCompanies)) return false;
    // already emailed from another tab recently: don't spend credits drafting again
    if (history[p.email.toLowerCase()]?.email || (p.ai["AI Draft Status"] ?? "") === "Emailed") return false;
    return true;
  });
  if (!rows.length) throw new Error("None of the selected rows are eligible for this campaign.");

  const runId = randomUUID();
  await db().insert(schema.jobRuns).values({ id: runId, spreadsheetId, tab, campaign, total: rows.length, startedBy: user.email });
  await db().insert(schema.jobItems).values(rows.map((rowKey) => ({ runId, rowKey, status: "queued" })));
  await inngest.send(
    rows.map((key) => ({ name: EVENTS.researchRow, data: { runId, spreadsheetId, tab, key, campaign, user: user.email } })),
  );
  await log({ userEmail: user.email, kind: "run", spreadsheetId, tab, message: `Started Research & Draft on ${rows.length} rows (${campaign})`, meta: { runId } });
  return { runId, count: rows.length, skipped: keys.length - rows.length };
}

export async function runProgress(runIds: string[]) {
  await requireUser();
  if (!runIds.length) return [];
  return db()
    .select({ runId: schema.jobItems.runId, rowKey: schema.jobItems.rowKey, status: schema.jobItems.status, error: schema.jobItems.error })
    .from(schema.jobItems)
    .where(inArray(schema.jobItems.runId, runIds));
}

export async function latestRun(spreadsheetId: string, tab: string) {
  await requireUser();
  const runs = await db().select().from(schema.jobRuns).where(eq(schema.jobRuns.spreadsheetId, spreadsheetId));
  return runs.filter((r) => r.tab === tab).sort((a, b) => +b.createdAt - +a.createdAt)[0] ?? null;
}
