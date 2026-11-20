import { and, eq, gte, inArray, ne, or, like, type SQL } from "drizzle-orm";
import { db, schema } from "@/db";

export interface ContactHistory {
  email?: { status: string; tab: string; at: string };
  linkedin?: { tab: string; at: string; by: string | null };
  x?: { tab: string; at: string; by: string | null };
}

/**
 * What has already happened to these addresses in ANY tab. The same person is often listed
 * in several tabs (e.g. Cartesia in Voice AI and Inference), so per-tab sheet columns alone
 * would let them get the same pitch twice.
 */
export async function contactHistory(emails: string[], sinceDays: number): Promise<Record<string, ContactHistory>> {
  const list = [...new Set(emails.map((e) => e.trim().toLowerCase()).filter(Boolean))];
  const out: Record<string, ContactHistory> = {};
  if (!list.length) return out;
  const since = new Date(Date.now() - sinceDays * 86_400_000);

  const sends = await db()
    .select({ to: schema.sendQueue.toEmail, status: schema.sendQueue.status, tab: schema.sendQueue.tab, at: schema.sendQueue.createdAt, sentAt: schema.sendQueue.sentAt })
    .from(schema.sendQueue)
    .where(and(eq(schema.sendQueue.kind, "prospect"), inArray(schema.sendQueue.status, ["sent", "queued", "sending"]), gte(schema.sendQueue.createdAt, since)));
  for (const s of sends) {
    const e = s.to.toLowerCase();
    if (!list.includes(e)) continue;
    const cur = out[e]?.email;
    const rank = (st: string) => (st === "sent" ? 2 : 1);
    if (!cur || rank(s.status) > rank(cur.status)) {
      out[e] = { ...out[e], email: { status: s.status, tab: s.tab, at: (s.sentAt ?? s.at).toISOString() } };
    }
  }

  // LinkedIn / X marks live in the activity log (kind linkedin|x, row key starts with the email).
  const conds: SQL[] = list.map((e) => like(schema.activity.rowKey, `${e.replace(/[%_]/g, "\\$&")}|%`));
  for (let i = 0; i < conds.length; i += 200) {
    const rows = await db()
      .select({ kind: schema.activity.kind, rowKey: schema.activity.rowKey, tab: schema.activity.tab, at: schema.activity.at, by: schema.activity.userEmail, message: schema.activity.message })
      .from(schema.activity)
      .where(and(inArray(schema.activity.kind, ["linkedin", "x"]), ne(schema.activity.level, "error"), or(...conds.slice(i, i + 200))))
      .orderBy(schema.activity.at);
    for (const r of rows) {
      const e = (r.rowKey ?? "").split("|")[0];
      const ch = r.kind as "linkedin" | "x";
      if (r.message.startsWith("Marked")) out[e] = { ...out[e], [ch]: { tab: r.tab ?? "", at: r.at.toISOString(), by: r.by } };
      else if (r.message.startsWith("Unmarked")) {
        const copy = { ...out[e] };
        delete copy[ch];
        out[e] = copy;
      }
    }
  }
  return out;
}

/** Is there already a live or sent email to this address (any tab) within the window, other than `exceptId`? */
export async function recentlyEmailed(email: string, sinceDays: number, exceptId?: string) {
  const since = new Date(Date.now() - sinceDays * 86_400_000);
  const rows = await db()
    .select({ id: schema.sendQueue.id, status: schema.sendQueue.status, tab: schema.sendQueue.tab })
    .from(schema.sendQueue)
    .where(and(eq(schema.sendQueue.kind, "prospect"), eq(schema.sendQueue.toEmail, email.trim().toLowerCase()), inArray(schema.sendQueue.status, ["sent", "queued", "sending"]), gte(schema.sendQueue.createdAt, since)));
  return rows.find((r) => r.id !== exceptId) ?? null;
}
