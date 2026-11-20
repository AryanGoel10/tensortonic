"use server";

import { eq } from "drizzle-orm";
import { requireUser } from "@/auth";
import { db, schema } from "@/db";
import { extractSpreadsheetId } from "@/lib/sheets/mapping";
import { getSpreadsheetInfo, readTab, serviceAccountEmail, ensureAiColumns } from "@/lib/sheets/client";
import { log, errMsg } from "@/lib/activity";

export async function listSheets() {
  await requireUser();
  return db().select().from(schema.connectedSheets).orderBy(schema.connectedSheets.createdAt);
}

export async function addSheet(input: string): Promise<{ ok: true; title: string } | { ok: false; error: string; serviceAccount?: string }> {
  const user = await requireUser();
  const id = extractSpreadsheetId(input);
  if (!id) return { ok: false, error: "That doesn't look like a Google Sheets URL." };
  try {
    const info = await getSpreadsheetInfo(id);
    await db()
      .insert(schema.connectedSheets)
      .values({ spreadsheetId: id, title: info.title, addedBy: user.email })
      .onConflictDoUpdate({ target: schema.connectedSheets.spreadsheetId, set: { title: info.title } });
    await log({ userEmail: user.email, kind: "sheet", spreadsheetId: id, message: `Connected sheet "${info.title}"` });
    return { ok: true, title: info.title };
  } catch (err) {
    const code = (err as { code?: number }).code;
    if (code === 403 || code === 404) {
      return {
        ok: false,
        error: "The service account can't open this sheet. Share the sheet with this address as Editor, then try again.",
        serviceAccount: serviceAccountEmail(),
      };
    }
    await log({ userEmail: user.email, level: "error", kind: "sheet", spreadsheetId: id, message: `Connect failed: ${errMsg(err)}` });
    return { ok: false, error: errMsg(err) };
  }
}

export async function removeSheet(spreadsheetId: string) {
  const user = await requireUser();
  await db().delete(schema.connectedSheets).where(eq(schema.connectedSheets.spreadsheetId, spreadsheetId));
  await log({ userEmail: user.email, kind: "sheet", spreadsheetId, message: "Disconnected sheet" });
}

export async function getTabs(spreadsheetId: string) {
  await requireUser();
  const info = await getSpreadsheetInfo(spreadsheetId);
  return info.tabs.map((t) => t.title);
}

/** Per-tab mapping report (M1 test): which fields mapped to which header, row counts, warnings. */
export async function tabReport(spreadsheetId: string) {
  await requireUser();
  const info = await getSpreadsheetInfo(spreadsheetId);
  const out = [];
  for (const t of info.tabs) {
    const { map, prospects } = await readTab(spreadsheetId, t.title);
    out.push({
      tab: t.title,
      rows: prospects.length,
      mapped: Object.fromEntries(Object.entries(map.fields).map(([f, i]) => [f, map.headers[i as number]])),
      aiColumnsPresent: 19 - map.missingAi.length,
      warnings: map.warnings,
      canDraft: map.canDraft,
      duplicates: prospects.length - new Set(prospects.map((p) => p.key)).size,
    });
  }
  return out;
}

export async function addAiColumns(spreadsheetId: string, tab: string) {
  const user = await requireUser();
  const added = await ensureAiColumns(spreadsheetId, tab);
  if (added.length)
    await log({ userEmail: user.email, kind: "sheet", spreadsheetId, tab, message: `Added ${added.length} AI columns` });
  return added;
}
