"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Badge, Button, Card, Notice } from "@/components/ui";
import { addSheet, listSheets, removeSheet, tabReport } from "@/app/actions/sheets";
import { cancelQueued, loadHistory, loadSettings, saveSettings, setSendingMailboxToMine } from "@/app/actions/settings";
import type { AppSettings } from "@/lib/settings-defaults";
import { TeamCard } from "./team";

type Loaded = Awaited<ReturnType<typeof loadSettings>>;
type Report = Awaited<ReturnType<typeof tabReport>>;

export function SettingsClient() {
  const params = useSearchParams();
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");
  const reload = () => loadSettings().then(setData).catch((e) => setError(e.message));
  useEffect(() => {
    reload();
    const z = params.get("zoho");
    if (z === "connected") setOk("Zoho mailbox connected.");
    if (z === "error") setError(`Zoho connection failed: ${params.get("msg") ?? "unknown error"}`);
  }, [params]);

  if (!data) return <div className="text-sm text-muted">{error || "Loading settings…"}</div>;
  const s = data.settings;
  const save = async (patch: Partial<AppSettings>) => {
    setError("");
    try {
      const next = await saveSettings(patch);
      setData((d) => (d ? { ...d, settings: next } : d));
      setOk("Saved.");
      setTimeout(() => setOk(""), 2000);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      {error && <Notice tone="error">{error}</Notice>}
      {ok && <Notice tone="ok">{ok}</Notice>}

      <TeamCard />

      <Sheets serviceAccount={data.serviceAccount} />

      <Card className="space-y-3 p-5">
        <h2 className="font-semibold">Email sending (Zoho Mail)</h2>
        <p className="text-sm text-muted">All emails go out from one mailbox: the sending mailbox below. Anyone signed in can approve and queue; the email still comes from that mailbox.</p>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span>Sending mailbox:</span>
          {data.sendingMailbox ? <Badge tone="Approved">{data.sendingMailbox.fromAddress}</Badge> : <Badge tone="Needs review">not connected</Badge>}
        </div>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span>Your Zoho:</span>
          {data.myMailbox ? <span>{data.myMailbox.fromAddress}</span> : <span className="text-muted">not connected</span>}
          <a href="/api/zoho/connect"><Button size="sm">{data.myMailbox ? "Reconnect" : "Connect Zoho Mail"}</Button></a>
          {data.myMailbox && data.sendingMailbox?.owner !== data.me.email && (
            <Button size="sm" onClick={async () => { await setSendingMailboxToMine(); reload(); }}>Use my mailbox for sending</Button>
          )}
        </div>
        <p className="text-xs text-muted">Zoho redirect URI to register: <code>{data.zohoRedirect}</code></p>
      </Card>

      <Card className="space-y-4 p-5">
        <h2 className="font-semibold">Safety and pacing</h2>
        <DryRun value={s.dryRun} onChange={(v) => save({ dryRun: v })} />
        <div className="grid gap-4 sm:grid-cols-3">
          <NumberField label="Daily cap per mailbox" value={s.dailyCap} onSave={(v) => save({ dailyCap: v })} />
          <NumberField label="Min gap (seconds)" value={s.minGapSeconds} onSave={(v) => save({ minGapSeconds: v })} />
          <NumberField label="Max gap (seconds)" value={s.maxGapSeconds} onSave={(v) => save({ maxGapSeconds: v })} />
        </div>
        <Toggle label="Allow sending on Saturday and Sunday" value={s.allowWeekends} onChange={(v) => save({ allowWeekends: v })} />
        <div className="grid gap-4 sm:grid-cols-3">
          <NumberField label="Don't email the same address twice within (days, across all tabs)" value={s.dedupeDays} onSave={(v) => save({ dedupeDays: v })} />
        </div>
        <TextField label="Never contact these companies (comma-separated; partners and customers)" value={s.excludedCompanies.join(", ")} onSave={(v) => save({ excludedCompanies: v.split(",").map((x) => x.trim()).filter(Boolean) })} />
      </Card>

      <Card className="space-y-3 p-5">
        <h2 className="font-semibold">Write-back to the team&apos;s columns</h2>
        <Toggle label='After an email sends, set Outreach Status ("Message Done" if it was empty, otherwise "Followed Up")' value={s.writeOutreachStatus} onChange={(v) => save({ writeOutreachStatus: v })} />
        <Toggle label="After an email sends, set Owner to the sender name if Owner is empty" value={s.writeOwner} onChange={(v) => save({ writeOwner: v })} />
        <Toggle label='After "Mark LinkedIn sent", set the Linkedin column to the name of whoever clicked it' value={s.writeLinkedin} onChange={(v) => save({ writeLinkedin: v })} />
        <TextField label="From name prospects see (e.g. Aryan Goel)" value={s.fromName} onSave={(v) => save({ fromName: v })} />
        <TextField label="Sender name written to Owner" value={s.senderDisplayName} onSave={(v) => save({ senderDisplayName: v })} />
      </Card>

      <Card className="space-y-4 p-5">
        <h2 className="font-semibold">Content</h2>
        <TextField label="Deck link" value={s.deckLink} onSave={(v) => save({ deckLink: v })} history="deckLink" />
        <TextArea label="Email signature (replaces {{SENDER_SIGNATURE}})" value={s.signature} rows={4} onSave={(v) => save({ signature: v })} history="signature" />
        <TextArea label="System prompt" value={s.systemPrompt} rows={18} onSave={(v) => save({ systemPrompt: v })} history="systemPrompt" reset={data.defaults.systemPrompt} />
        <TextArea label="First-touch email template" value={s.emailTemplateFirst} rows={14} onSave={(v) => save({ emailTemplateFirst: v })} history="emailTemplateFirst" reset={data.defaults.emailTemplateFirst} />
        <TextArea label="Re-engage email template" value={s.emailTemplateReengage} rows={4} onSave={(v) => save({ emailTemplateReengage: v })} history="emailTemplateReengage" reset={data.defaults.emailTemplateReengage} />
        <TextArea label="LinkedIn note instructions" value={s.linkedinTemplate} rows={5} onSave={(v) => save({ linkedinTemplate: v })} history="linkedinTemplate" reset={data.defaults.linkedinTemplate} />
        <TextArea label="X DM instructions" value={s.xTemplate} rows={3} onSave={(v) => save({ xTemplate: v })} history="xTemplate" reset={data.defaults.xTemplate} />
      </Card>

      <Card className="p-5">
        <h2 className="mb-3 font-semibold">Send queue (latest 25)</h2>
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-muted">
            <tr><th className="py-1">Created</th><th>To</th><th>Subject</th><th>Status</th><th /></tr>
          </thead>
          <tbody>
            {data.queue.map((q) => (
              <tr key={q.id} className="border-t border-border">
                <td className="py-1.5 text-xs text-muted">{new Date(q.createdAt).toLocaleString()}</td>
                <td className="text-xs">{q.toEmail}{q.kind === "test" && " (test)"}</td>
                <td className="max-w-xs truncate text-xs">{q.subject}</td>
                <td><Badge tone={q.status === "sent" ? "Emailed" : q.status === "failed" ? "Failed" : q.status === "queued" ? "Queued" : undefined}>{q.status}</Badge>{q.error && <span className="ml-1 text-xs text-muted">{q.error}</span>}</td>
                <td>{q.status === "queued" && <Button size="sm" variant="ghost" onClick={async () => { await cancelQueued(q.id); reload(); }}>Cancel</Button>}</td>
              </tr>
            ))}
            {data.queue.length === 0 && <tr><td colSpan={5} className="py-3 text-center text-xs text-muted">Nothing queued yet.</td></tr>}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

function Sheets({ serviceAccount }: { serviceAccount: string }) {
  const [sheets, setSheets] = useState<{ spreadsheetId: string; title: string; addedBy: string }[]>([]);
  const [url, setUrl] = useState("");
  const [err, setErr] = useState<{ error: string; serviceAccount?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<{ id: string; rows: Report } | null>(null);
  const load = () => listSheets().then(setSheets);
  useEffect(() => {
    load();
  }, []);
  return (
    <Card className="space-y-3 p-5">
      <h2 className="font-semibold">Connected sheets</h2>
      <p className="text-sm text-muted">Share each sheet with <code className="rounded bg-neutral-100 px-1">{serviceAccount}</code> as Editor, then paste its URL.</p>
      <div className="flex gap-2">
        <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://docs.google.com/spreadsheets/d/…" className="h-9 flex-1 rounded-md border border-border px-2 text-sm" />
        <Button variant="primary" disabled={!url || busy} onClick={async () => {
          setBusy(true);
          setErr(null);
          const r = await addSheet(url);
          setBusy(false);
          if (!r.ok) setErr(r);
          else { setUrl(""); load(); }
        }}>Connect</Button>
      </div>
      {err && <Notice tone="error">{err.error} {err.serviceAccount && <code className="font-semibold">{err.serviceAccount}</code>}</Notice>}
      <ul className="divide-y divide-border">
        {sheets.map((s) => (
          <li key={s.spreadsheetId} className="flex items-center gap-3 py-2 text-sm">
            <span className="font-medium">{s.title}</span>
            <span className="text-xs text-muted">added by {s.addedBy}</span>
            <div className="ml-auto flex gap-2">
              <Button size="sm" onClick={async () => setReport({ id: s.spreadsheetId, rows: await tabReport(s.spreadsheetId) })}>Tab report</Button>
              <Button size="sm" variant="ghost" onClick={async () => { if (confirm(`Disconnect "${s.title}"? The sheet itself isn't changed.`)) { await removeSheet(s.spreadsheetId); load(); } }}>Disconnect</Button>
            </div>
          </li>
        ))}
      </ul>
      {report && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-left text-muted"><tr><th className="py-1">Tab</th><th>Rows</th><th>Mapped columns</th><th>AI cols</th><th>Draftable</th><th>Warnings</th></tr></thead>
            <tbody>
              {report.rows.map((r) => (
                <tr key={r.tab} className="border-t border-border align-top">
                  <td className="py-1.5 font-medium">{r.tab}</td>
                  <td>{r.rows}{r.duplicates ? ` (${r.duplicates} dup)` : ""}</td>
                  <td className="max-w-md">{Object.entries(r.mapped).map(([f, h]) => `${f}←${h}`).join(", ")}</td>
                  <td>{r.aiColumnsPresent}/19</td>
                  <td>{r.canDraft ? "yes" : "no"}</td>
                  <td className="text-amber-800">{r.warnings.join(" ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function DryRun({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState("");
  return (
    <div className={`rounded-md border p-3 ${value ? "border-amber-200 bg-amber-50" : "border-red-200 bg-red-50"}`}>
      <div className="flex items-center gap-3">
        <div className="flex-1 text-sm">
          <b>Dry-run is {value ? "ON" : "OFF"}.</b> {value ? "Queued emails are logged, not sent. \"Send test to me\" still sends to your own address." : "Approved, queued emails are really being sent from the sending mailbox."}
        </div>
        {value ? (
          <Button variant="danger" onClick={() => setConfirming(true)}>Turn off dry-run…</Button>
        ) : (
          <Button onClick={() => onChange(true)}>Turn dry-run back on</Button>
        )}
      </div>
      {confirming && (
        <div className="mt-3 space-y-2 border-t border-amber-200 pt-3 text-sm">
          <p>Real emails will go out to prospects from the sending mailbox for every queued draft. Type <b>SEND</b> to confirm.</p>
          <div className="flex gap-2">
            <input value={typed} onChange={(e) => setTyped(e.target.value)} className="h-8 w-32 rounded-md border border-border px-2" />
            <Button variant="danger" disabled={typed !== "SEND"} onClick={() => { onChange(false); setConfirming(false); setTyped(""); }}>Turn off dry-run</Button>
            <Button variant="ghost" onClick={() => setConfirming(false)}>Cancel</Button>
          </div>
        </div>
      )}
    </div>
  );
}

function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} /> {label}
    </label>
  );
}

function NumberField({ label, value, onSave }: { label: string; value: number; onSave: (v: number) => void }) {
  const [v, setV] = useState(String(value));
  useEffect(() => setV(String(value)), [value]);
  return (
    <label className="block text-sm">
      <div className="mb-1 text-xs font-medium text-muted">{label}</div>
      <input type="number" value={v} onChange={(e) => setV(e.target.value)} onBlur={() => Number(v) !== value && onSave(Number(v))} className="h-9 w-full rounded-md border border-border px-2" />
    </label>
  );
}

function TextField({ label, value, onSave, history }: { label: string; value: string; onSave: (v: string) => void; history?: keyof AppSettings }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return (
    <label className="block text-sm">
      <div className="mb-1 flex items-center justify-between text-xs font-medium text-muted">{label}{history && <History k={history} onRestore={(x) => onSave(String(x))} />}</div>
      <div className="flex gap-2">
        <input value={v} onChange={(e) => setV(e.target.value)} className="h-9 flex-1 rounded-md border border-border px-2" />
        <Button disabled={v === value} onClick={() => onSave(v)}>Save</Button>
      </div>
    </label>
  );
}

function TextArea({ label, value, rows, onSave, history, reset }: { label: string; value: string; rows: number; onSave: (v: string) => void; history?: keyof AppSettings; reset?: string }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return (
    <div className="text-sm">
      <div className="mb-1 flex items-center justify-between text-xs font-medium text-muted">
        <span>{label}</span>
        <span className="flex items-center gap-3">
          {reset && reset !== value && <button className="underline" onClick={() => setV(reset)}>Load default</button>}
          {history && <History k={history} onRestore={(x) => setV(String(x))} />}
        </span>
      </div>
      <textarea value={v} onChange={(e) => setV(e.target.value)} rows={rows} className="w-full rounded-md border border-border px-2 py-1.5 font-mono text-xs leading-relaxed" />
      <div className="mt-1 flex justify-end gap-2">
        {v !== value && <Button size="sm" variant="ghost" onClick={() => setV(value)}>Discard</Button>}
        <Button size="sm" variant="primary" disabled={v === value} onClick={() => onSave(v)}>Save</Button>
      </div>
    </div>
  );
}

function History({ k, onRestore }: { k: keyof AppSettings; onRestore: (v: unknown) => void }) {
  const [items, setItems] = useState<{ id: number; value: unknown; updatedBy: string | null; updatedAt: Date }[] | null>(null);
  return (
    <span className="relative">
      <button className="underline" onClick={async () => setItems(items ? null : await loadHistory(k))}>History</button>
      {items && (
        <div className="absolute right-0 z-10 mt-1 w-72 rounded-md border border-border bg-white p-2 text-left shadow-lg">
          {items.length === 0 && <div className="text-xs text-muted">No earlier versions.</div>}
          {items.map((h) => (
            <button key={h.id} className="block w-full rounded px-2 py-1 text-left text-xs hover:bg-neutral-50" onClick={() => { onRestore(h.value); setItems(null); }}>
              {new Date(h.updatedAt).toLocaleString()} · {h.updatedBy}
            </button>
          ))}
        </div>
      )}
    </span>
  );
}
