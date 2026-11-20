"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { SheetPicker, useSelection } from "@/components/sheet-picker";
import { Badge, Card, Counter, Notice } from "@/components/ui";
import { SocialButtons, xState } from "@/components/social";
import { loadReview } from "@/app/actions/review";
import type { Prospect } from "@/lib/sheets/mapping";
import type { ContactHistory } from "@/lib/history";
import { HistoryNotes } from "../review/client";
import { charCount, LIMITS } from "@/lib/validator";

/**
 * Pratham's page: every approved draft whose LinkedIn note or X DM hasn't been sent yet.
 * One row per person: read the message, copy + open, send by hand, mark sent.
 */
export function ReadyClient() {
  const { sheet, tab } = useSelection();
  const [rows, setRows] = useState<Prospect[]>([]);
  const [history, setHistory] = useState<Record<string, ContactHistory>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showDone, setShowDone] = useState(false);

  const refresh = useCallback(async () => {
    if (!sheet || !tab) return;
    setLoading(true);
    try {
      const r = await loadReview(sheet, tab);
      setRows(r.prospects);
      setHistory(r.history);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [sheet, tab]);

  useEffect(() => {
    setRows([]);
    refresh();
  }, [refresh]);

  const approved = rows.filter((p) => ["Approved", "Queued", "Emailed"].includes(p.ai["AI Draft Status"] ?? ""));
  const list = useMemo(
    () => approved.filter((p) => showDone || !p.ai["AI LinkedIn Sent At"] || (!p.ai["AI X Sent At"] && !xState(p).blocked)),
    [approved, showDone],
  );
  const liLeft = approved.filter((p) => !p.ai["AI LinkedIn Sent At"]).length;
  const xLeft = approved.filter((p) => !p.ai["AI X Sent At"] && !xState(p).blocked).length;
  const patch = (key: string, ai: Partial<Prospect["ai"]>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ai: { ...r.ai, ...ai } } : r)));

  return (
    <div className="space-y-4">
      <SheetPicker onRefresh={refresh} />
      {error && <Notice tone="error">{error}</Notice>}
      {tab && (
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span><b>{liLeft}</b> LinkedIn to send</span>
          <span><b>{xLeft}</b> X DMs to send</span>
          <label className="ml-auto flex items-center gap-1.5 text-xs text-muted">
            <input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} /> Show finished
          </label>
        </div>
      )}
      {tab && !loading && list.length === 0 && <Notice tone="ok">All caught up. Approved drafts show up here.</Notice>}
      <div className="space-y-3">
        {list.map((p) => (
          <Card key={p.key} className="p-4">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <span className="font-semibold">{p.firstName} {p.lastName}</span>
              <span className="text-sm text-neutral-600">{p.title} · {p.company}</span>
              <Badge tone={p.ai["AI Draft Status"]}>{p.ai["AI Draft Status"]}</Badge>
              {p.linkedinStatus && p.linkedinStatus.toLowerCase() !== "none" && <Badge>Already on LinkedIn: {p.linkedinStatus}</Badge>}
            </div>
            <div className="mb-2"><HistoryNotes history={history[p.email.toLowerCase()]} currentTab={tab} emailed /></div>
            <div className="mb-3 grid gap-3 md:grid-cols-2">
              <Message label="LinkedIn note" text={p.ai["AI LinkedIn Note"] ?? ""} max={LIMITS.linkedin} sent={p.ai["AI LinkedIn Sent At"]} />
              <Message label="X DM" text={p.ai["AI X DM"] ?? ""} max={LIMITS.x} sent={p.ai["AI X Sent At"]} />
            </div>
            <SocialButtons compact sheet={sheet} tab={tab} p={p} onChange={(ai) => patch(p.key, ai)} />
          </Card>
        ))}
      </div>
    </div>
  );
}

function Message({ label, text, max, sent }: { label: string; text: string; max: number; sent?: string }) {
  return (
    <div className={sent ? "opacity-50" : ""}>
      <div className="mb-1 flex items-center justify-between text-xs font-medium text-muted">
        <span>{label}{sent ? " · sent" : ""}</span>
        <Counter value={charCount(text)} max={max} />
      </div>
      <div className="whitespace-pre-wrap rounded-md border border-border bg-neutral-50 px-2 py-1.5 text-sm">{text}</div>
    </div>
  );
}
