import { and, eq, gte, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { inngest, EVENTS, type ResearchRowData, type SendEmailData } from "./client";
import { readRow, writeRow, RowWriteError } from "@/lib/sheets/client";
import { buildResearchPack } from "@/lib/research/firecrawl";
import { firstDraft, fixDraft, type DraftResult } from "@/lib/ai/generate";
import { draftToColumns, savePack } from "@/lib/drafts";
import { getSettings } from "@/lib/settings";
import { log, errMsg } from "@/lib/activity";
import { sendMail } from "@/lib/zoho";
import { SIGNATURE_TOKEN } from "@/lib/validator";
import { isWeekend, nextMorning, startOfLocalDay } from "@/lib/time";
import type { ResearchPack } from "@/lib/types";
import { recentlyEmailed } from "@/lib/history";
import { isExcludedCompany } from "@/lib/eligibility";

async function setItem(runId: string, rowKey: string, status: string, error?: string) {
  await db()
    .update(schema.jobItems)
    .set({ status, error: error ?? null, updatedAt: new Date() })
    .where(and(eq(schema.jobItems.runId, runId), eq(schema.jobItems.rowKey, rowKey)));
}

// ---------- Research & Draft (one run per row, 3 at a time) ----------
export const researchRow = inngest.createFunction(
  {
    id: "research-and-draft-row",
    triggers: [{ event: EVENTS.researchRow }],
    concurrency: { limit: 2 }, // Gemini free tier allows only a few requests per minute
    retries: 5,
    onFailure: async ({ event, error }) => {
      const d = (event.data as { event: { data: ResearchRowData } }).event.data;
      await setItem(d.runId, d.key, "failed", error.message);
      try {
        await writeRow(d.spreadsheetId, d.tab, d.key, { "AI Draft Status": "Failed", "AI Flags": `FAIL: ${error.message}` });
      } catch (e) {
        await log({ level: "error", kind: "draft", spreadsheetId: d.spreadsheetId, tab: d.tab, rowKey: d.key, message: `Couldn't mark row failed: ${errMsg(e)}` });
      }
      await log({ level: "error", kind: "draft", userEmail: d.user, spreadsheetId: d.spreadsheetId, tab: d.tab, rowKey: d.key, message: `Research & Draft failed: ${error.message}` });
    },
  },
  async ({ event, step, attempt }) => {
    const d = event.data as ResearchRowData;
    const ctx = { spreadsheetId: d.spreadsheetId, tab: d.tab, rowKey: d.key, userEmail: d.user };
    // Record a step failure on the row (shown in the table) and in the log, then let Inngest retry.
    const guard = async <T>(name: string, status: string, fn: () => Promise<T>): Promise<T> => {
      try {
        return await fn();
      } catch (err) {
        const msg = errMsg(err);
        await setItem(d.runId, d.key, status, `${name} failed (attempt ${attempt + 1}), retrying: ${msg}`);
        await log({ ...ctx, level: "warn", kind: "draft", message: `${name} failed (attempt ${attempt + 1}): ${msg}` });
        throw err;
      }
    };

    const prospect = await step.run("load-row", async () => {
      const { prospect, matches } = await readRow(d.spreadsheetId, d.tab, d.key);
      if (!prospect) throw new Error(matches ? "Row key matches more than one row" : "Row not found (edited or deleted?)");
      await writeRow(d.spreadsheetId, d.tab, d.key, { "AI Draft Status": "Researching", "AI Campaign": d.campaign });
      await setItem(d.runId, d.key, "researching");
      return prospect;
    });

    const pack = (await step.run("research", () =>
      guard("Research", "researching", () =>
        buildResearchPack(prospect, (message, meta) => log({ ...ctx, level: "warn", kind: "research", message, meta })),
      ),
    )) as ResearchPack;

    const first = (await step.run("write", () =>
      guard("Writing", "drafting", async () => {
        await setItem(d.runId, d.key, "drafting");
        return firstDraft(prospect, pack, d.campaign, await getSettings());
      }),
    )) as DraftResult;

    const result = first.validation.ok
      ? first
      : ((await step.run("fix", () =>
          guard("Fixing draft", "drafting", async () => fixDraft(prospect, pack, d.campaign, await getSettings(), first)),
        )) as DraftResult);

    await step.run("write-back", async () => {
      await savePack(d.spreadsheetId, d.tab, d.key, pack, result.draft);
      await writeRow(d.spreadsheetId, d.tab, d.key, draftToColumns(result.draft, pack, result.validation, d.campaign));
      await setItem(d.runId, d.key, "done");
      await log({
        ...ctx,
        kind: "draft",
        message: `${result.validation.ok ? "Drafted" : "Needs review"} (${pack.creditsUsed} Firecrawl credits, ${result.attempts} Claude call${result.attempts > 1 ? "s" : ""})`,
        meta: { hard: result.validation.hard, soft: result.validation.soft, personX: pack.personX },
      });
    });

    return { ok: result.validation.ok };
  },
);

// ---------- Send queue (one at a time per mailbox, capped and spaced) ----------
type Claim = { action: "go" } | { action: "wait"; until: string; reason: string } | { action: "stop"; reason: string };

function randomGap(min: number, max: number) {
  return Math.round((min + Math.random() * Math.max(0, max - min)) * 1000);
}

export const sendEmail = inngest.createFunction(
  {
    id: "send-email",
    triggers: [{ event: EVENTS.sendEmail }],
    concurrency: { limit: 1, key: "event.data.sender" },
    retries: 3,
    onFailure: async ({ event, error }) => {
      const d = (event.data as { event: { data: SendEmailData } }).event.data;
      const [q] = await db().select().from(schema.sendQueue).where(eq(schema.sendQueue.id, d.queueId));
      await db().update(schema.sendQueue).set({ status: "failed", error: error.message }).where(eq(schema.sendQueue.id, d.queueId));
      if (q && q.kind === "prospect") {
        try {
          await writeRow(q.spreadsheetId, q.tab, q.rowKey, { "AI Draft Status": "Failed", "AI Flags": `FAIL: send failed: ${error.message}` });
        } catch {}
      }
      await log({ level: "error", kind: "send", spreadsheetId: q?.spreadsheetId, tab: q?.tab, rowKey: q?.rowKey, message: `Send failed: ${error.message}` });
    },
  },
  async ({ event, step }) => {
    const { queueId } = event.data as SendEmailData;

    for (let i = 0; i < 40; i++) {
      // Check + claim in one step. Concurrency 1 per mailbox makes this exclusive.
      const claim = (await step.run(`claim-${i}`, async (): Promise<Claim> => {
        const [q] = await db().select().from(schema.sendQueue).where(eq(schema.sendQueue.id, queueId));
        if (!q) return { action: "stop", reason: "queue item missing" };
        if (q.status !== "queued") return { action: "stop", reason: `status is ${q.status}` };
        const s = await getSettings();
        const now = new Date();
        const isDry = s.dryRun && q.kind === "prospect";
        if (isDry || q.kind === "test") return { action: "go" };

        if (!s.allowWeekends && isWeekend(now))
          return { action: "wait", until: nextMorning(now, true).toISOString(), reason: "weekend" };

        const [{ count }] = await db()
          .select({ count: sql<number>`count(*)::int` })
          .from(schema.sendQueue)
          .where(and(eq(schema.sendQueue.senderEmail, q.senderEmail), eq(schema.sendQueue.status, "sent"), eq(schema.sendQueue.kind, "prospect"), gte(schema.sendQueue.sentAt, startOfLocalDay(now))));
        if (count >= s.dailyCap)
          return { action: "wait", until: nextMorning(now, !s.allowWeekends).toISOString(), reason: `daily cap ${s.dailyCap} reached` };

        const [mb] = await db().select().from(schema.zohoAccounts).where(eq(schema.zohoAccounts.userEmail, q.senderEmail));
        if (!mb) return { action: "stop", reason: `no Zoho mailbox connected for ${q.senderEmail}` };
        const [last] = await db()
          .select({ sentAt: schema.sendQueue.sentAt })
          .from(schema.sendQueue)
          .where(and(eq(schema.sendQueue.senderEmail, q.senderEmail), eq(schema.sendQueue.status, "sent")))
          .orderBy(sql`${schema.sendQueue.sentAt} desc nulls last`)
          .limit(1);
        if (last?.sentAt) {
          const earliest = last.sentAt.getTime() + randomGap(s.minGapSeconds, s.maxGapSeconds);
          if (earliest > now.getTime()) return { action: "wait", until: new Date(earliest).toISOString(), reason: "gap between sends" };
        }
        await db().update(schema.sendQueue).set({ status: "sending" }).where(eq(schema.sendQueue.id, queueId));
        return { action: "go" };
      })) as Claim;

      if (claim.action === "stop") {
        if (claim.reason.startsWith("no Zoho")) {
          await step.run("fail-no-mailbox", async () => {
            await db().update(schema.sendQueue).set({ status: "failed", error: claim.reason }).where(eq(schema.sendQueue.id, queueId));
            await log({ level: "error", kind: "send", message: claim.reason, meta: { queueId } });
          });
        }
        return { stopped: claim.reason };
      }
      if (claim.action === "wait") {
        await step.sleepUntil(`wait-${i}`, new Date(claim.until));
        continue;
      }

      return await step.run("send", async () => {
        const [q] = await db().select().from(schema.sendQueue).where(eq(schema.sendQueue.id, queueId));
        const s = await getSettings();
        const ctx = { spreadsheetId: q.spreadsheetId, tab: q.tab, rowKey: q.rowKey, userEmail: q.queuedBy };
        const body = q.body.replace(SIGNATURE_TOKEN, s.signature).trim();

        if (q.kind === "test") {
          const r = await sendMail(q.senderEmail, q.toEmail, `[TEST] ${q.subject}`, body, s.fromName);
          await db().update(schema.sendQueue).set({ status: "sent", sentAt: new Date(), zohoMessageId: r.messageId }).where(eq(schema.sendQueue.id, queueId));
          await log({ ...ctx, kind: "send", message: `Test email sent to ${q.toEmail}` });
          return { test: true };
        }

        // Pre-send re-check against the live sheet.
        const { prospect } = await readRow(q.spreadsheetId, q.tab, q.rowKey);
        const cancel = async (reason: string) => {
          await db().update(schema.sendQueue).set({ status: "cancelled", error: reason }).where(eq(schema.sendQueue.id, queueId));
          if (prospect) {
            try {
              await writeRow(q.spreadsheetId, q.tab, q.rowKey, { "AI Draft Status": "Approved" });
            } catch {}
          }
          await log({ ...ctx, level: "warn", kind: "send", message: `Send cancelled: ${reason}` });
          return { cancelled: reason };
        };
        if (!prospect) return cancel("row not found or duplicated");
        if (prospect.outreachStatus.toLowerCase() === "meeting booked") return cancel("Outreach Status is Meeting Booked");
        if (prospect.email.trim().toLowerCase() !== q.toEmail.trim().toLowerCase()) return cancel("email address changed in the sheet");
        if (isExcludedCompany(prospect.company, s.excludedCompanies)) return cancel(`${prospect.company} is on the never-contact list`);
        const dup = await recentlyEmailed(q.toEmail, s.dedupeDays, q.id);
        if (dup && dup.status === "sent") return cancel(`already emailed from the "${dup.tab}" tab`);
        if ((prospect.ai["AI Draft Status"] ?? "") !== "Queued") return cancel(`AI Draft Status changed to ${prospect.ai["AI Draft Status"] || "empty"}`);

        if (s.dryRun) {
          await db().update(schema.sendQueue).set({ status: "dry_run", sentAt: new Date() }).where(eq(schema.sendQueue.id, queueId));
          await writeRow(q.spreadsheetId, q.tab, q.rowKey, { "AI Draft Status": "Approved" });
          await log({ ...ctx, kind: "send", message: `DRY RUN: would send "${q.subject}" to ${q.toEmail} from ${q.senderEmail}`, meta: { body } });
          return { dryRun: true };
        }

        const r = await sendMail(q.senderEmail, q.toEmail, q.subject, body, s.fromName);
        const sentAt = new Date();
        await db().update(schema.sendQueue).set({ status: "sent", sentAt, zohoMessageId: r.messageId }).where(eq(schema.sendQueue.id, queueId));

        const patch: Parameters<typeof writeRow>[3] = {
          "AI Draft Status": "Emailed",
          "AI Email Sent At": sentAt.toISOString(),
          "AI Email Sent By": q.senderEmail,
          "AI Zoho Message ID": r.messageId,
        };
        if (s.writeOutreachStatus) {
          const current = prospect.outreachStatus.trim();
          patch["Outreach Status"] = q.campaign === "Re-engage" || current ? "Followed Up" : "Message Done";
        }
        if (s.writeOwner && !prospect.owner.trim()) patch["Owner"] = s.senderDisplayName;
        try {
          await writeRow(q.spreadsheetId, q.tab, q.rowKey, patch);
        } catch (e) {
          // The email went out. Don't retry the step (that would send twice); log loudly instead.
          await log({ ...ctx, level: "error", kind: "send", message: `Email SENT but sheet write-back failed: ${e instanceof RowWriteError ? e.message : errMsg(e)}`, meta: { patch } });
        }
        await log({ ...ctx, kind: "send", message: `Emailed ${q.toEmail} ("${q.subject}")`, meta: { messageId: r.messageId } });
        return { sent: true };
      });
    }
    return { stopped: "too many waits" };
  },
);

export const functions = [researchRow, sendEmail];
