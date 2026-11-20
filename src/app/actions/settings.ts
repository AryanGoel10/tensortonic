"use server";

import { requireUser } from "@/auth";
import { getHistory, getSettings, updateSettings } from "@/lib/settings";
import type { AppSettings } from "@/lib/settings-defaults";
import { DEFAULT_SETTINGS } from "@/lib/settings-defaults";
import { getMailbox, redirectUri } from "@/lib/zoho";
import { log } from "@/lib/activity";
import { db, schema } from "@/db";
import { desc, eq } from "drizzle-orm";
import { serviceAccountEmail } from "@/lib/sheets/client";

export async function loadSettings() {
  const user = await requireUser();
  const s = await getSettings();
  const mine = await getMailbox(user.email);
  const sending = s.sendingMailbox ? await getMailbox(s.sendingMailbox) : null;
  const queue = await db().select().from(schema.sendQueue).orderBy(desc(schema.sendQueue.createdAt)).limit(25);
  return {
    settings: s,
    defaults: DEFAULT_SETTINGS,
    me: user,
    myMailbox: mine ? { fromAddress: mine.fromAddress, connectedAt: mine.connectedAt } : null,
    sendingMailbox: sending ? { owner: s.sendingMailbox, fromAddress: sending.fromAddress } : null,
    zohoRedirect: redirectUri(),
    serviceAccount: serviceAccountEmail(),
    queue,
  };
}

export async function saveSettings(patch: Partial<AppSettings>) {
  const user = await requireUser();
  const clean: Partial<AppSettings> = { ...patch };
  if (clean.dedupeDays !== undefined) clean.dedupeDays = Math.max(0, Math.round(clean.dedupeDays));
  if (clean.dailyCap !== undefined) clean.dailyCap = Math.max(1, Math.min(100, Math.round(clean.dailyCap)));
  if (clean.minGapSeconds !== undefined) clean.minGapSeconds = Math.max(30, Math.round(clean.minGapSeconds));
  if (clean.maxGapSeconds !== undefined) clean.maxGapSeconds = Math.max(clean.minGapSeconds ?? 30, Math.round(clean.maxGapSeconds));
  await updateSettings(clean, user.email);
  const keys = Object.keys(clean);
  if ("dryRun" in clean) {
    await log({ userEmail: user.email, level: clean.dryRun ? "info" : "warn", kind: "settings", message: clean.dryRun ? "Dry-run turned ON" : "Dry-run turned OFF. Real emails will be sent." });
  } else {
    await log({ userEmail: user.email, kind: "settings", message: `Updated ${keys.join(", ")}` });
  }
  return getSettings();
}

export async function setSendingMailboxToMine() {
  const user = await requireUser();
  const mb = await getMailbox(user.email);
  if (!mb) throw new Error("Connect your Zoho mailbox first");
  await updateSettings({ sendingMailbox: user.email }, user.email);
  await log({ userEmail: user.email, kind: "zoho", message: `Sending mailbox set to ${mb.fromAddress}` });
}

export async function loadHistory(key: keyof AppSettings) {
  await requireUser();
  return getHistory(key);
}

export async function cancelQueued(queueId: string) {
  const user = await requireUser();
  const [q] = await db().select().from(schema.sendQueue).where(eq(schema.sendQueue.id, queueId));
  if (!q || q.status !== "queued") return;
  await db().update(schema.sendQueue).set({ status: "cancelled", error: `cancelled by ${user.email}` }).where(eq(schema.sendQueue.id, queueId));
  if (q.kind === "prospect") {
    const { writeRow } = await import("@/lib/sheets/client");
    try {
      await writeRow(q.spreadsheetId, q.tab, q.rowKey, { "AI Draft Status": "Approved" });
    } catch {}
  }
  await log({ userEmail: user.email, kind: "send", spreadsheetId: q.spreadsheetId, tab: q.tab, rowKey: q.rowKey, message: "Cancelled queued email" });
}
