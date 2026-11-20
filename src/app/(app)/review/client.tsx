"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { SheetPicker, useSelection } from "@/components/sheet-picker";
import { Badge, Button, Card, Counter, Notice } from "@/components/ui";
import { SocialButtons, httpsUrl } from "@/components/social";
import { editField, loadReview, loadSources, queueEmails, regenerate, sendTestToSelf, setStatus } from "@/app/actions/review";
import type { Prospect } from "@/lib/sheets/mapping";
import type { ContactHistory } from "@/lib/history";
import { bodyWordCount, charCount, LIMITS } from "@/lib/validator";

type View = "review" | "approved" | "done";
const VIEW_STATUSES: Record<View, string[]> = {
  review: ["Drafted", "Needs review", "Failed"],
  approved: ["Approved", "Queued"],
  done: ["Emailed", "Rejected", "Skipped"],
};

function splitFlags(s: string | undefined) {
  const parts = (s ?? "").split(";").map((x) => x.trim()).filter(Boolean);
  return { hard: parts.filter((p) => p.startsWith("FAIL:")).map((p) => p.slice(5).trim()), soft: parts.filter((p) => !p.startsWith("FAIL:")) };
}

export function ReviewClient() {
  const { sheet, tab } = useSelection();
  const [rows, setRows] = useState<Prospect[]>([]);
  const [history, setHistory] = useState<Record<string, ContactHistory>>({});
  const [dryRun, setDryRun] = useState(true);
  const [view, setView] = useState<View>("review");
  const [active, setActive] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error" | "warn"; text: string } | null>(null);

  const refresh = useCallback(async () => {
    if (!sheet || !tab) return;
    setLoading(true);
    try {
      const r = await loadReview(sheet, tab);
      setRows(r.prospects);
      setHistory(r.history);
      setDryRun(r.dryRun);
    } catch (e) {
      setMessage({ tone: "error", text: (e as Error).message });
    } finally {
      setLoading(false);
    }
  }, [sheet, tab]);

  useEffect(() => {
    setRows([]);
    setSelected(new Set());
    refresh();
  }, [refresh]);

  const list = useMemo(() => rows.filter((p) => VIEW_STATUSES[view].includes(p.ai["AI Draft Status"] ?? "")), [rows, view]);
  useEffect(() => setActive((a) => Math.min(a, Math.max(0, list.length - 1))), [list.length]);

  const patchRow = useCallback((key: string, patch: Partial<Prospect["ai"]>) => {
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ai: { ...r.ai, ...patch } } : r)));
  }, []);
  const replaceRow = useCallback((p: Prospect) => setRows((rs) => rs.map((r) => (r.key === p.key ? p : r))), []);

  const doStatus = useCallback(
    async (keys: string[], status: "Approved" | "Rejected" | "Skipped" | "Drafted") => {
      const res = await setStatus(sheet, tab, keys, status);
      for (const r of res) if (r.ok) patchRow(r.key, { "AI Draft Status": status });
      const bad = res.filter((r) => !r.ok);
      setMessage(bad.length ? { tone: "error", text: bad.map((b) => b.error).join(" · ") } : { tone: "ok", text: `${res.length} marked ${status}.` });
      return res;
    },
    [sheet, tab, patchRow],
  );

  const doQueue = useCallback(
    async (keys: string[]) => {
      const res = await queueEmails(sheet, tab, keys);
      for (const r of res) if (r.ok) patchRow(r.key, { "AI Draft Status": "Queued" });
      const bad = res.filter((r) => !r.ok);
      const okCount = res.length - bad.length;
      setMessage(
        bad.length
          ? { tone: "error", text: `${okCount} queued. Problems: ${bad.map((b) => b.error).join(" · ")}` }
          : { tone: "ok", text: `${okCount} email${okCount === 1 ? "" : "s"} queued${dryRun ? " in DRY RUN (nothing will actually send)" : ". They go out spaced 1 to 3 minutes apart"}.` },
      );
    },
    [sheet, tab, patchRow, dryRun],
  );

  // Keyboard: A approve, R regenerate, J/K next/prev
  const regenRef = useRef<Record<string, () => void>>({});
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName) || e.metaKey || e.ctrlKey || e.altKey) return;
      const cur = list[active];
      if (e.key === "j") setActive((a) => Math.min(list.length - 1, a + 1));
      else if (e.key === "k") setActive((a) => Math.max(0, a - 1));
      else if (e.key === "a" && cur && view === "review") doStatus([cur.key], "Approved").then((r) => r[0]?.ok && setActive((a) => a));
      else if (e.key === "r" && cur) regenRef.current[cur.key]?.();
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [list, active, view, doStatus]);

  useEffect(() => {
    document.getElementById(`card-${active}`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [active]);

  const counts = Object.fromEntries((Object.keys(VIEW_STATUSES) as View[]).map((v) => [v, rows.filter((p) => VIEW_STATUSES[v].includes(p.ai["AI Draft Status"] ?? "")).length]));
  const selectedInView = list.filter((p) => selected.has(p.key));

  return (
    <div className="space-y-4">
      <SheetPicker onRefresh={refresh} />
      {tab && (
        <div className="flex flex-wrap items-center gap-2">
          {(["review", "approved", "done"] as View[]).map((v) => (
            <button key={v} onClick={() => { setView(v); setActive(0); setSelected(new Set()); }} className={clsx("rounded-md px-3 py-1.5 text-sm", view === v ? "bg-black text-white" : "border border-border bg-white")}>
              {v === "review" ? "To review" : v === "approved" ? "Approved" : "Done"} <span className="opacity-60">{counts[v]}</span>
            </button>
          ))}
          <span className="ml-2 text-xs text-muted">Keys: A approve · R regenerate · J/K next/prev</span>
          <div className="ml-auto flex items-center gap-2">
            {list.length > 0 && (
              <label className="flex items-center gap-1.5 text-xs">
                <input type="checkbox" checked={list.every((p) => selected.has(p.key))} onChange={(e) => setSelected(e.target.checked ? new Set(list.map((p) => p.key)) : new Set())} /> Select all
              </label>
            )}
            {view === "review" && (
              <Button variant="primary" disabled={!selectedInView.length} onClick={async () => {
                const res = await doStatus(selectedInView.map((p) => p.key), "Approved");
                const ok = res.filter((r) => r.ok).map((r) => r.key);
                if (ok.length) await doQueue(ok);
                setSelected(new Set());
              }}>
                Approve &amp; queue selected ({selectedInView.length})
              </Button>
            )}
            {view === "approved" && (
              <Button variant="primary" disabled={!selectedInView.filter((p) => p.ai["AI Draft Status"] === "Approved").length} onClick={async () => {
                await doQueue(selectedInView.filter((p) => p.ai["AI Draft Status"] === "Approved").map((p) => p.key));
                setSelected(new Set());
              }}>
                Queue emails ({selectedInView.filter((p) => p.ai["AI Draft Status"] === "Approved").length})
              </Button>
            )}
          </div>
        </div>
      )}
      {message && <Notice tone={message.tone}>{message.text}</Notice>}
      {tab && !loading && list.length === 0 && <Notice>Nothing here yet. Run Research &amp; Draft on the Prospects page.</Notice>}

      <div className="space-y-4">
        {list.map((p, i) => (
          <DraftCard
            key={p.key}
            index={i}
            p={p}
            sheet={sheet}
            tab={tab}
            active={i === active}
            onFocus={() => setActive(i)}
            selected={selected.has(p.key)}
            onSelect={(v) => setSelected((s) => { const n = new Set(s); if (v) n.add(p.key); else n.delete(p.key); return n; })}
            patchRow={patchRow}
            replaceRow={replaceRow}
            doStatus={doStatus}
            doQueue={doQueue}
            registerRegen={(fn) => (regenRef.current[p.key] = fn)}
            setMessage={setMessage}
            dryRun={dryRun}
            history={history[p.email.toLowerCase()]}
            currentTab={tab}
          />
        ))}
      </div>
    </div>
  );
}

interface CardProps {
  index: number;
  p: Prospect;
  sheet: string;
  tab: string;
  active: boolean;
  onFocus: () => void;
  selected: boolean;
  onSelect: (v: boolean) => void;
  patchRow: (key: string, patch: Partial<Prospect["ai"]>) => void;
  replaceRow: (p: Prospect) => void;
  doStatus: (keys: string[], status: "Approved" | "Rejected" | "Skipped" | "Drafted") => Promise<unknown>;
  doQueue: (keys: string[]) => Promise<void>;
  registerRegen: (fn: () => void) => void;
  setMessage: (m: { tone: "ok" | "error" | "warn"; text: string } | null) => void;
  dryRun: boolean;
  history?: ContactHistory;
  currentTab: string;
}

type Sources = Awaited<ReturnType<typeof loadSources>>;

export function DraftCard({ index, p, sheet, tab, active, onFocus, selected, onSelect, patchRow, replaceRow, doStatus, doQueue, registerRegen, setMessage, history, currentTab }: CardProps) {
  const status = p.ai["AI Draft Status"] ?? "";
  const flags = splitFlags(p.ai["AI Flags"]);
  const [sources, setSources] = useState<Sources>(null);
  const [showRegen, setShowRegen] = useState(false);
  const [instruction, setInstruction] = useState("");
  const [busy, setBusy] = useState("");
  const [saving, setSaving] = useState<Record<string, "saving" | "saved" | "error">>({});
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const locked = status === "Queued" || status === "Emailed";

  useEffect(() => {
    registerRegen(() => setShowRegen(true));
  }, [registerRegen]);

  useEffect(() => {
    if (active && !sources) loadSources(sheet, tab, p.key).then(setSources).catch(() => {});
  }, [active, sources, sheet, tab, p.key]);

  const save = (field: "subject" | "body" | "linkedin" | "x" | "xUrl" | "hook" | "challenge", col: keyof Prospect["ai"], value: string, immediate = false) => {
    patchRow(p.key, { [col]: value });
    clearTimeout(timers.current[field]);
    const run = async () => {
      setSaving((s) => ({ ...s, [field]: "saving" }));
      const r = await editField(sheet, tab, p.key, field, value);
      if (!r.ok) {
        setSaving((s) => ({ ...s, [field]: "error" }));
        setMessage({ tone: "error", text: r.error });
        return;
      }
      setSaving((s) => ({ ...s, [field]: "saved" }));
      const flagStr = [...r.hard.map((h) => `FAIL: ${h}`), ...r.soft].join("; ");
      patchRow(p.key, { "AI Flags": flagStr, "AI Draft Status": r.status, ...(field === "xUrl" ? { "AI X Confidence": value.trim() ? "confirmed" : "" } : {}) });
    };
    if (immediate) run();
    else timers.current[field] = setTimeout(run, 900);
  };

  const doRegen = async () => {
    setBusy("regen");
    const r = await regenerate(sheet, tab, p.key, instruction);
    setBusy("");
    if (!r.ok) return setMessage({ tone: "error", text: r.error });
    replaceRow(r.prospect);
    setSources(null);
    setShowRegen(false);
    setInstruction("");
    setMessage({ tone: "ok", text: `Regenerated ${p.firstName}'s draft.` });
  };

  const subject = p.ai["AI Email Subject"] ?? "";
  const body = p.ai["AI Email Body"] ?? "";
  const linkedin = p.ai["AI LinkedIn Note"] ?? "";
  const xdm = p.ai["AI X DM"] ?? "";
  const xUrl = p.ai["AI Person X URL"] ?? "";
  const xConf = p.ai["AI X Confidence"] ?? "";

  return (
    <Card className={clsx("scroll-mt-24 transition-shadow", active && "ring-2 ring-accent")}>
      <div id={`card-${index}`} onClick={onFocus} className="grid gap-0 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        {/* Left: person + research */}
        <div className="space-y-3 border-b border-border p-4 lg:border-r lg:border-b-0">
          <div className="flex items-start gap-2">
            <input type="checkbox" className="mt-1" checked={selected} onChange={(e) => onSelect(e.target.checked)} onClick={(e) => e.stopPropagation()} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">{p.firstName} {p.lastName}</span>
                <Badge tone={status}>{status}</Badge>
                {p.ai["AI Campaign"] && <Badge>{p.ai["AI Campaign"]}</Badge>}
              </div>
              <div className="text-sm text-neutral-700">{p.title} · <b>{p.company}</b></div>
              <div className="text-xs text-muted">
                {p.email} · Outreach: {p.outreachStatus || "—"} · LinkedIn: {p.linkedinStatus || "—"}
              </div>
              <div className="mt-1 flex flex-wrap gap-3 text-xs">
                {p.personLinkedin && <a className="underline" href={httpsUrl(p.personLinkedin)} target="_blank" rel="noreferrer">LinkedIn</a>}
                {p.website && <a className="underline" href={httpsUrl(p.website)} target="_blank" rel="noreferrer">Website</a>}
                {p.companyTwitter && <a className="underline" href={httpsUrl(p.companyTwitter)} target="_blank" rel="noreferrer">Company X</a>}
              </div>
            </div>
          </div>

          <HistoryNotes history={history} currentTab={currentTab} emailed={status === "Emailed"} />
          {(flags.hard.length > 0 || flags.soft.length > 0) && (
            <div className="space-y-1">
              {flags.hard.map((f) => (
                <div key={f} className="rounded border border-red-200 bg-red-50 px-2 py-1 text-xs text-red-800">✕ {f}</div>
              ))}
              {flags.soft.length > 0 && <div className="flex flex-wrap gap-1">{flags.soft.map((f) => <Badge key={f} tone="Needs review">{f}</Badge>)}</div>}
            </div>
          )}

          <Section title="Research summary">{p.ai["AI Research Summary"]}</Section>
          <EditableLine label="Hook" value={p.ai["AI Hook"] ?? ""} disabled={locked} onChange={(v) => save("hook", "AI Hook", v)} />
          {sources?.hookSource && (
            <div className="-mt-2 truncate text-xs">
              Source: <a className="underline" href={sources.hookSource} target="_blank" rel="noreferrer">{sources.hookSource}</a>
            </div>
          )}
          <EditableLine label="Challenge idea" value={p.ai["AI Challenge Idea"] ?? ""} disabled={locked} onChange={(v) => save("challenge", "AI Challenge Idea", v)} />

          <div>
            <div className="mb-1 flex items-center gap-2 text-xs font-medium text-muted">
              Person X URL
              {xConf && <Badge tone={xConf === "low" ? "Needs review" : "Approved"}>{xConf}</Badge>}
              {saving.xUrl === "saving" && <span>saving…</span>}
            </div>
            <div className="flex gap-2">
              <input
                defaultValue={xUrl}
                key={xUrl}
                placeholder="https://x.com/handle"
                className="h-8 flex-1 rounded-md border border-border px-2 text-sm"
                onBlur={(e) => e.target.value !== xUrl && save("xUrl", "AI Person X URL", e.target.value.trim(), true)}
              />
              {xConf === "low" && xUrl && (
                <Button size="sm" onClick={() => save("xUrl", "AI Person X URL", xUrl, true)}>Confirm</Button>
              )}
              {xUrl && <a href={httpsUrl(xUrl)} target="_blank" rel="noreferrer" className="self-center text-xs underline">open</a>}
            </div>
            {sources?.personX?.evidence && <div className="mt-1 text-xs text-muted">{sources.personX.evidence}</div>}
          </div>

          {sources && (
            <details className="text-xs">
              <summary className="cursor-pointer text-muted">Sources ({1 + sources.pages.length + sources.recent.length}) · {sources.creditsUsed} credits</summary>
              <ul className="mt-1 space-y-1">
                <li><a className="underline" href={sources.homepage} target="_blank" rel="noreferrer">{sources.homepage}</a></li>
                {sources.pages.map((pg) => (
                  <li key={pg.url}><a className="underline" href={pg.url} target="_blank" rel="noreferrer">{pg.title || pg.url}</a></li>
                ))}
                {sources.recent.map((r) => (
                  <li key={r.url}>
                    <Badge>{r.kind}</Badge> <a className="underline" href={r.url} target="_blank" rel="noreferrer">{r.title}</a>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>

        {/* Right: drafts */}
        <div className="space-y-3 p-4">
          <Field label="Email subject" counter={<Counter value={charCount(subject)} max={LIMITS.subject} />} state={saving.subject}>
            <input value={subject} disabled={locked} onChange={(e) => save("subject", "AI Email Subject", e.target.value)} className="h-9 w-full rounded-md border border-border px-2 text-sm disabled:bg-neutral-50" />
          </Field>
          <Field label="Email body (from your Zoho, signature added on send)" counter={<Counter value={bodyWordCount(body)} max={LIMITS.bodyWords} />} unit="words" state={saving.body}>
            <textarea value={body} disabled={locked} onChange={(e) => save("body", "AI Email Body", e.target.value)} rows={18} className="w-full rounded-md border border-border px-2 py-1.5 text-sm leading-relaxed disabled:bg-neutral-50" />
          </Field>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="LinkedIn note (Pratham)" counter={<Counter value={charCount(linkedin)} max={LIMITS.linkedin} />} state={saving.linkedin}>
              <textarea value={linkedin} onChange={(e) => save("linkedin", "AI LinkedIn Note", e.target.value)} rows={5} className="w-full rounded-md border border-border px-2 py-1.5 text-sm" />
            </Field>
            <Field label="X DM (Pratham)" counter={<Counter value={charCount(xdm)} max={LIMITS.x} />} state={saving.x}>
              <textarea value={xdm} onChange={(e) => save("x", "AI X DM", e.target.value)} rows={5} className="w-full rounded-md border border-border px-2 py-1.5 text-sm" />
            </Field>
          </div>

          {showRegen && (
            <div className="flex gap-2 rounded-md border border-border bg-neutral-50 p-2">
              <input autoFocus value={instruction} onChange={(e) => setInstruction(e.target.value)} onKeyDown={(e) => e.key === "Enter" && doRegen()} placeholder='Optional instruction, e.g. "make the challenge about their MCP server"' className="h-8 flex-1 rounded-md border border-border px-2 text-sm" />
              <Button size="sm" variant="primary" disabled={busy === "regen"} onClick={doRegen}>{busy === "regen" ? "Writing…" : "Regenerate"}</Button>
              <Button size="sm" variant="ghost" onClick={() => setShowRegen(false)}>Cancel</Button>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
            {["Drafted", "Needs review", "Failed", "Rejected", "Skipped"].includes(status) && (
              <>
                <Button variant="primary" disabled={flags.hard.length > 0} title={flags.hard.length ? "Fix the failing checks first" : "A"} onClick={() => doStatus([p.key], "Approved")}>Approve</Button>
                <Button onClick={() => setShowRegen((v) => !v)} title="R">Regenerate</Button>
                <Button variant="ghost" onClick={() => doStatus([p.key], "Skipped")}>Skip</Button>
                <Button variant="danger" onClick={() => doStatus([p.key], "Rejected")}>Reject</Button>
              </>
            )}
            {status === "Approved" && (
              <>
                <Button variant="primary" onClick={() => doQueue([p.key])}>Queue email</Button>
                <Button
                  disabled={busy === "test"}
                  onClick={async () => {
                    setBusy("test");
                    const r = await sendTestToSelf(sheet, tab, p.key);
                    setBusy("");
                    setMessage(r.ok ? { tone: "ok", text: `Test email queued to ${r.to}. It arrives in a minute.` } : { tone: "error", text: r.error });
                  }}
                >
                  Send test to me
                </Button>
                <Button variant="ghost" onClick={() => doStatus([p.key], "Drafted")}>Unapprove</Button>
              </>
            )}
            {status === "Queued" && <span className="text-sm text-violet-700">Email queued. Cancel it from Settings → Send queue if needed.</span>}
            {status === "Emailed" && <span className="text-sm text-accent-ink">Emailed {p.ai["AI Email Sent At"] ? new Date(p.ai["AI Email Sent At"]).toLocaleString() : ""}</span>}
          </div>

          {["Approved", "Queued", "Emailed"].includes(status) && (
            <div className="rounded-md border border-border bg-neutral-50 p-3">
              <div className="mb-2 text-xs font-medium text-muted">Pratham&apos;s channels</div>
              <SocialButtons sheet={sheet} tab={tab} p={p} onChange={(patch) => patchRow(p.key, patch)} />
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-0.5 text-xs font-medium text-muted">{title}</div>
      <div className="text-sm leading-relaxed">{children || <span className="text-muted">—</span>}</div>
    </div>
  );
}

function EditableLine({ label, value, onChange, disabled }: { label: string; value: string; onChange: (v: string) => void; disabled?: boolean }) {
  return (
    <div>
      <div className="mb-0.5 text-xs font-medium text-muted">{label}</div>
      <textarea value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} rows={2} className="w-full resize-y rounded-md border border-transparent bg-transparent px-1 py-0.5 text-sm hover:border-border focus:border-border focus:bg-white disabled:hover:border-transparent" />
    </div>
  );
}

function Field({ label, counter, children, state, unit }: { label: string; counter: React.ReactNode; children: React.ReactNode; state?: string; unit?: string }) {
  return (
    <label className="block">
      <div className="mb-1 flex items-center justify-between text-xs font-medium text-muted">
        <span>{label}</span>
        <span className="flex items-center gap-2">
          {state === "saving" && <span>saving…</span>}
          {state === "saved" && <span className="text-accent-ink">saved to sheet</span>}
          {state === "error" && <span className="text-red-600">save failed</span>}
          {counter}
          {unit && <span>{unit}</span>}
        </span>
      </div>
      {children}
    </label>
  );
}

export function HistoryNotes({ history, currentTab, emailed }: { history?: ContactHistory; currentTab: string; emailed?: boolean }) {
  if (!history) return null;
  const notes: string[] = [];
  if (history.email && !(emailed && history.email.tab === currentTab))
    notes.push(`Email ${history.email.status === "sent" ? "already sent" : "already queued"} from the ${history.email.tab} tab (${new Date(history.email.at).toLocaleDateString()}). It won't be sent again.`);
  if (history.linkedin && history.linkedin.tab !== currentTab) notes.push(`LinkedIn already marked sent from ${history.linkedin.tab} by ${history.linkedin.by ?? "someone"}.`);
  if (history.x && history.x.tab !== currentTab) notes.push(`X already marked sent from ${history.x.tab} by ${history.x.by ?? "someone"}.`);
  if (!notes.length) return null;
  return <div className="space-y-1">{notes.map((n) => <div key={n} className="rounded border border-violet-200 bg-violet-50 px-2 py-1 text-xs text-violet-800">{n}</div>)}</div>;
}
