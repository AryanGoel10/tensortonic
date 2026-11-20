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
    const msg = errMsg(err);
    await log({ userEmail: user.email, level: "error", kind: "sheet", spreadsheetId: id, message: `Connect failed (${code ?? "?"}): ${msg}` });
    if (/has not been used|is disabled|SERVICE_DISABLED|accessNotConfigured/i.test(msg)) {
      const project = msg.match(/project[= ](\d+|[a-z][a-z0-9-]+)/i)?.[1];
      return {
        ok: false,
        error: `The Google Sheets API is turned off in your Google Cloud project. Enable it at https://console.cloud.google.com/apis/library/sheets.googleapis.com${project ? `?project=${project}` : ""}, wait a minute, then click Connect again.`,
      };
    }
    if (code === 403 || code === 404) {
      return {
        ok: false,
        error: `Google said: "${msg}". If the sheet isn't shared yet, share it with this address as Editor, then try again.`,
        serviceAccount: serviceAccountEmail(),
      };
    }
    return { ok: false, error: msg };
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
