"use server";

import { randomUUID } from "node:crypto";
import { requireUser, type AppUser } from "@/auth";
import { db, schema } from "@/db";
import { readRow, readTab, writeRow } from "@/lib/sheets/client";
import type { AiColumn, Prospect, WritableColumn } from "@/lib/sheets/mapping";
import { getSettings } from "@/lib/settings";
import { applyEdit, draftToColumns, loadPack, savePack, validateRow, EDITABLE } from "@/lib/drafts";
import { generateDraft } from "@/lib/ai/generate";
import { log, errMsg } from "@/lib/activity";
import { inngest, EVENTS } from "@/inngest/client";
import type { Campaign, Draft } from "@/lib/types";
import { getMailbox } from "@/lib/zoho";
import { contactHistory, recentlyEmailed } from "@/lib/history";
import { isExcludedCompany } from "@/lib/eligibility";

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

function displayName(u: AppUser) {
  return u.name.split(/\s+/)[0] || u.email.split("@")[0];
}

async function mustRow(spreadsheetId: string, tab: string, key: string): Promise<Prospect> {
  const { prospect, matches } = await readRow(spreadsheetId, tab, key);
  if (!prospect) throw new Error(matches ? `Key ${key} matches ${matches} rows. Fix the duplicate in the sheet.` : `Row ${key} not found. It may have been edited.`);
  return prospect;
}

async function guarded<T extends object>(user: AppUser, ctx: { spreadsheetId: string; tab: string; key?: string; kind: string }, fn: () => Promise<T>): Promise<Result<T>> {
  try {
    return { ok: true, ...(await fn()) };
  } catch (err) {
    await log({ userEmail: user.email, level: "error", kind: ctx.kind, spreadsheetId: ctx.spreadsheetId, tab: ctx.tab, rowKey: ctx.key, message: errMsg(err) });
    return { ok: false, error: errMsg(err) };
  }
}

export async function loadReview(spreadsheetId: string, tab: string) {
  await requireUser();
  const { prospects } = await readTab(spreadsheetId, tab);
  const relevant = prospects.filter((p) => (p.ai["AI Draft Status"] ?? "") !== "");
  const s = await getSettings();
  return {
    prospects: relevant,
    history: await contactHistory(relevant.map((p) => p.email), s.dedupeDays),
    deckLink: s.deckLink,
    dryRun: s.dryRun,
  };
}

export async function loadSources(spreadsheetId: string, tab: string, key: string) {
  await requireUser();
  const stored = await loadPack(spreadsheetId, tab, key);
  if (!stored) return null;
  const { pack, draft } = stored;
  return {
    hookSource: draft?.hook_source_url ?? null,
    homepage: pack.homepageUrl ?? pack.website,
    pages: pack.extraPages.map((p) => ({ url: p.url, title: p.title })),
    recent: pack.recent,
    docsUrl: pack.docsUrl ?? null,
    personX: pack.personX ?? null,
    companyX: pack.companyX ?? null,
    creditsUsed: pack.creditsUsed,
  };
}

export async function editField(spreadsheetId: string, tab: string, key: string, field: keyof typeof EDITABLE, value: string) {
  const user = await requireUser();
  return guarded(user, { spreadsheetId, tab, key, kind: "edit" }, async () => {
    if (!(field in EDITABLE)) throw new Error("Unknown field");
    const s = await getSettings();
    const r = await applyEdit(spreadsheetId, tab, key, field, value, s);
    return { hard: r.validation.hard, soft: r.validation.soft, status: r.status };
  });
}

export async function regenerate(spreadsheetId: string, tab: string, key: string, instruction: string) {
  const user = await requireUser();
  return guarded(user, { spreadsheetId, tab, key, kind: "draft" }, async () => {
    const p = await mustRow(spreadsheetId, tab, key);
    const stored = await loadPack(spreadsheetId, tab, key);
    if (!stored) throw new Error("No research saved for this row. Run Research & Draft first.");
    const s = await getSettings();
    const previous: Draft = {
      ...(stored.draft as Draft),
      email_subject: p.ai["AI Email Subject"] ?? "",
      email_body: p.ai["AI Email Body"] ?? "",
      linkedin_note: p.ai["AI LinkedIn Note"] ?? "",
      x_dm: p.ai["AI X DM"] ?? "",
      hook: p.ai["AI Hook"] ?? stored.draft?.hook ?? "",
      challenge_idea: p.ai["AI Challenge Idea"] ?? stored.draft?.challenge_idea ?? "",
    };
    const campaign = (p.ai["AI Campaign"] as Campaign) || "Fresh pitch";
    const { draft, validation } = await generateDraft(p, stored.pack, campaign, s, { previous, instruction });
    await savePack(spreadsheetId, tab, key, stored.pack, draft);
    const cols = draftToColumns(draft, stored.pack, validation, campaign);
    // keep a reviewer-confirmed X URL
    if ((p.ai["AI X Confidence"] ?? "") === "confirmed") {
      delete cols["AI Person X URL"];
      delete cols["AI X Confidence"];
    }
    await writeRow(spreadsheetId, tab, key, cols);
    await log({ userEmail: user.email, kind: "draft", spreadsheetId, tab, rowKey: key, message: `Regenerated${instruction ? `: "${instruction}"` : ""}` });
    const fresh = await mustRow(spreadsheetId, tab, key);
    return { prospect: fresh };
  });
}

export async function setStatus(spreadsheetId: string, tab: string, keys: string[], status: "Approved" | "Rejected" | "Skipped" | "Drafted") {
  const user = await requireUser();
  const s = await getSettings();
  const results: { key: string; ok: boolean; error?: string }[] = [];
  for (const key of keys) {
    try {
      const p = await mustRow(spreadsheetId, tab, key);
      const current = p.ai["AI Draft Status"] ?? "";
      if (["Queued", "Emailed"].includes(current)) throw new Error(`Already ${current}`);
      if (status === "Approved") {
        const v = await validateRow(p, spreadsheetId, tab, s);
        if (!v.ok) throw new Error(`Fix these first: ${v.hard.join(", ")}`);
      }
      await writeRow(spreadsheetId, tab, key, { "AI Draft Status": status });
      await log({ userEmail: user.email, kind: "approve", spreadsheetId, tab, rowKey: key, message: `${status}` });
      results.push({ key, ok: true });
    } catch (err) {
      await log({ userEmail: user.email, level: "warn", kind: "approve", spreadsheetId, tab, rowKey: key, message: `${status} failed: ${errMsg(err)}` });
      results.push({ key, ok: false, error: errMsg(err) });
    }
  }
  return results;
}

/** Queue approved emails. They always go from the configured sending mailbox (Aryan's). */
export async function queueEmails(spreadsheetId: string, tab: string, keys: string[]) {
  const user = await requireUser();
  const s = await getSettings();
  if (!s.sendingMailbox) return [{ key: "", ok: false, error: "No sending mailbox set. Connect Zoho in Settings first." }];
  if (!s.dryRun && !(await getMailbox(s.sendingMailbox)))
    return [{ key: "", ok: false, error: `Zoho isn't connected for ${s.sendingMailbox}.` }];

  const results: { key: string; ok: boolean; error?: string }[] = [];
  for (const key of keys) {
    try {
      const p = await mustRow(spreadsheetId, tab, key);
      if ((p.ai["AI Draft Status"] ?? "") !== "Approved") throw new Error("Only approved drafts can be queued");
      if (p.outreachStatus.toLowerCase() === "meeting booked") throw new Error("Meeting already booked");
      if (isExcludedCompany(p.company, s.excludedCompanies)) throw new Error(`${p.company} is on the never-contact list`);
      const dup = await recentlyEmailed(p.email, s.dedupeDays);
      if (dup) throw new Error(`${p.email} was already ${dup.status === "sent" ? "emailed" : "queued"} from the "${dup.tab}" tab in the last ${s.dedupeDays} days`);
      const v = await validateRow(p, spreadsheetId, tab, s);
      if (!v.ok) throw new Error(`Fix these first: ${v.hard.join(", ")}`);
      const id = randomUUID();
      await db().insert(schema.sendQueue).values({
        id,
        spreadsheetId,
        tab,
        rowKey: key,
        campaign: p.ai["AI Campaign"] || "Fresh pitch",
        senderEmail: s.sendingMailbox,
        toEmail: p.email.trim().toLowerCase(),
        subject: p.ai["AI Email Subject"] ?? "",
        body: p.ai["AI Email Body"] ?? "",
        status: "queued",
        queuedBy: user.email,
      });
      await writeRow(spreadsheetId, tab, key, { "AI Draft Status": "Queued" });
      await inngest.send({ name: EVENTS.sendEmail, data: { queueId: id, sender: s.sendingMailbox } });
      await log({ userEmail: user.email, kind: "send", spreadsheetId, tab, rowKey: key, message: `Queued email to ${p.email}${s.dryRun ? " (dry run)" : ""}` });
      results.push({ key, ok: true });
    } catch (err) {
      await log({ userEmail: user.email, level: "warn", kind: "send", spreadsheetId, tab, rowKey: key, message: `Queue failed: ${errMsg(err)}` });
      results.push({ key, ok: false, error: errMsg(err) });
    }
  }
  return results;
}

/** Send this draft to the signed-in user's own address, from the sending mailbox. Works in dry-run too. */
export async function sendTestToSelf(spreadsheetId: string, tab: string, key: string) {
  const user = await requireUser();
  return guarded(user, { spreadsheetId, tab, key, kind: "send" }, async () => {
    const s = await getSettings();
    if (!s.sendingMailbox || !(await getMailbox(s.sendingMailbox))) throw new Error("Connect the sending Zoho mailbox in Settings first.");
    const p = await mustRow(spreadsheetId, tab, key);
    const id = randomUUID();
    await db().insert(schema.sendQueue).values({
      id,
      spreadsheetId,
      tab,
      rowKey: key,
      campaign: p.ai["AI Campaign"] || "Fresh pitch",
      senderEmail: s.sendingMailbox,
      toEmail: user.email,
      subject: p.ai["AI Email Subject"] ?? "",
      body: p.ai["AI Email Body"] ?? "",
      kind: "test",
      status: "queued",
      queuedBy: user.email,
    });
    await inngest.send({ name: EVENTS.sendEmail, data: { queueId: id, sender: s.sendingMailbox } });
    return { to: user.email };
  });
}

/** Pratham's one-click flow: after sending on LinkedIn / X, record it in the sheet. */
export async function markSocialSent(spreadsheetId: string, tab: string, key: string, channel: "linkedin" | "x", undo = false) {
  const user = await requireUser();
  return guarded(user, { spreadsheetId, tab, key, kind: channel }, async () => {
    const s = await getSettings();
    const p = await mustRow(spreadsheetId, tab, key);
    const status = p.ai["AI Draft Status"] ?? "";
    if (!undo && !["Approved", "Queued", "Emailed"].includes(status)) throw new Error("Approve the draft first");
    const patch: Partial<Record<WritableColumn, string>> = {};
    const col: AiColumn = channel === "linkedin" ? "AI LinkedIn Sent At" : "AI X Sent At";
    patch[col] = undo ? "" : new Date().toISOString();
    if (channel === "linkedin" && s.writeLinkedin && !undo) patch["Linkedin"] = displayName(user);
    await writeRow(spreadsheetId, tab, key, patch);
    await log({ userEmail: user.email, kind: channel, spreadsheetId, tab, rowKey: key, message: undo ? `Unmarked ${channel} sent` : `Marked ${channel === "x" ? "X" : "LinkedIn"} sent` });
    return { at: patch[col] };
  });
}

