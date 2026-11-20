"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { SheetPicker, useSelection } from "@/components/sheet-picker";
import { Badge, Button, Notice } from "@/components/ui";
import { loadTab, startRun, runProgress, costEstimate, type TabView } from "@/app/actions/prospects";
import { addAiColumns } from "@/app/actions/sheets";
import { eligible } from "@/lib/eligibility";
import type { Campaign } from "@/lib/types";
import type { Prospect } from "@/lib/sheets/mapping";
import type { ContactHistory } from "@/lib/history";

const ALL = "__all__";
const EMPTY = "__empty__";

function uniq(values: string[]) {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

export function ProspectsClient() {
  const { sheet, tab } = useSelection();
  const [data, setData] = useState<TabView | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [campaign, setCampaign] = useState<Campaign>("Fresh pitch");
  const [fOutreach, setFOutreach] = useState(ALL);
  const [fOwner, setFOwner] = useState(ALL);
  const [fDraft, setFDraft] = useState(ALL);
  const [showHidden, setShowHidden] = useState(false);
  const [search, setSearch] = useState("");
  const [confirm, setConfirm] = useState<null | { rows: number; creditsMin: number; creditsMax: number; redraft: number; needColumns: boolean }>(null);
  const [runs, setRuns] = useState<string[]>([]);
  const [progress, setProgress] = useState<Record<string, { status: string; error: string | null }>>({});
  const [message, setMessage] = useState("");

  const refresh = useCallback(async () => {
    if (!sheet || !tab) return;
    setLoading(true);
    setError("");
    try {
      setData(await loadTab(sheet, tab));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [sheet, tab]);

  useEffect(() => {
    setData(null);
    setSelected(new Set());
    setRuns([]);
    setProgress({});
    refresh();
  }, [refresh]);

  // Live progress while a run is active.
  useEffect(() => {
    if (!runs.length) return;
    let stop = false;
    const tick = async () => {
      const items = await runProgress(runs);
      if (stop) return;
      const map: Record<string, { status: string; error: string | null }> = {};
      for (const it of items) map[it.rowKey] = { status: it.status, error: it.error };
      setProgress(map);
      const active = items.some((i) => !["done", "failed"].includes(i.status));
      if (!active) {
        setRuns([]);
        setMessage(`Run finished: ${items.filter((i) => i.status === "done").length} drafted, ${items.filter((i) => i.status === "failed").length} failed.`);
        refresh();
      }
    };
    tick();
    const id = setInterval(tick, 3000);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, [runs, refresh]);

  const prospects = useMemo(() => data?.prospects ?? [], [data]);
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return prospects.filter((p) => {
      const draft = p.ai["AI Draft Status"] ?? "";
      if (!showHidden && (p.outreachStatus.toLowerCase() === "meeting booked" || draft === "Emailed")) return false;
      if (fOutreach !== ALL && (fOutreach === EMPTY ? p.outreachStatus !== "" : p.outreachStatus !== fOutreach)) return false;
      if (fOwner !== ALL && (fOwner === EMPTY ? p.owner !== "" : p.owner !== fOwner)) return false;
      if (fDraft !== ALL && (fDraft === EMPTY ? draft !== "" : draft !== fDraft)) return false;
      if (q && !`${p.firstName} ${p.lastName} ${p.company} ${p.title} ${p.email}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [prospects, showHidden, fOutreach, fOwner, fDraft, search]);

  const excluded = data?.excludedCompanies ?? [];
  const alreadyEmailed = (p: Prospect) => !!data?.history[p.email.toLowerCase()]?.email || (p.ai["AI Draft Status"] ?? "") === "Emailed";
  const canPick = (p: Prospect) => eligible(p, campaign, excluded) && !(data?.duplicateKeys ?? []).includes(p.key) && !alreadyEmailed(p);
  const eligibleVisible = visible.filter(canPick);
  const selectedRows = prospects.filter((p) => selected.has(p.key));
  const selectedEligible = selectedRows.filter(canPick);

  const toggle = (key: string) => {
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });
  };

  const askRun = async () => {
    const est = await costEstimate(selectedEligible.length);
    const redraft = selectedEligible.filter((p) => (p.ai["AI Draft Status"] ?? "") !== "").length;
    setConfirm({ ...est, redraft, needColumns: (data?.missingAi.length ?? 0) > 0 });
  };

  const doRun = async () => {
    if (!confirm) return;
    setMessage("");
    try {
      if (confirm.needColumns) await addAiColumns(sheet, tab);
      const r = await startRun(sheet, tab, selectedEligible.map((p) => p.key), campaign);
      setRuns((x) => [...x, r.runId]);
      setMessage(`Started on ${r.count} rows${r.skipped ? ` (${r.skipped} skipped as not eligible)` : ""}. Progress updates live below.`);
      setSelected(new Set());
      setConfirm(null);
      if (confirm.needColumns) refresh();
    } catch (e) {
      setError((e as Error).message);
      setConfirm(null);
    }
  };

  const outreachValues = uniq(prospects.map((p) => p.outreachStatus).filter(Boolean));
  const ownerValues = uniq(prospects.map((p) => p.owner).filter(Boolean));
  const draftValues = uniq(prospects.map((p) => p.ai["AI Draft Status"] ?? "").filter(Boolean));

  return (
    <div className="space-y-4">
      <SheetPicker onRefresh={refresh} right={tab && <Link href={`/review?sheet=${sheet}&tab=${encodeURIComponent(tab)}`} className="text-sm font-medium underline">Go to review →</Link>} />

      {error && <Notice tone="error">{error}</Notice>}
      {message && <Notice tone="ok">{message}</Notice>}
      {data?.warnings.map((w) => (
        <Notice key={w} tone={data.canDraft ? "warn" : "error"}>{w}</Notice>
      ))}
      {data && data.duplicateKeys.length > 0 && (
        <Notice tone="warn">
          {data.duplicateKeys.length} email+company key(s) appear on more than one row, so the tool will not write to them: {data.duplicateKeys.slice(0, 5).join(", ")}
        </Notice>
      )}

      {tab && data && (
        <>
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-white p-3">
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, company, email" className="h-8 w-56 rounded-md border border-border px-2 text-sm" />
            <Filter label="Outreach" value={fOutreach} onChange={setFOutreach} values={outreachValues} />
            <Filter label="Owner" value={fOwner} onChange={setFOwner} values={ownerValues} />
            <Filter label="AI status" value={fDraft} onChange={setFDraft} values={draftValues} />
            <label className="flex items-center gap-1.5 text-xs text-muted">
              <input type="checkbox" checked={showHidden} onChange={(e) => setShowHidden(e.target.checked)} /> Show Meeting Booked / Emailed
            </label>
            <div className="ml-auto flex items-center gap-2">
              <select value={campaign} onChange={(e) => setCampaign(e.target.value as Campaign)} className="h-8 rounded-md border border-border px-2 text-sm" title="Campaign type">
                <option value="Fresh pitch">Fresh pitch (everyone, new Gradium pitch)</option>
                <option value="Re-engage">Re-engage (mentions earlier outreach)</option>
              </select>
              <Button variant="primary" disabled={!data.canDraft || selectedEligible.length === 0 || runs.length > 0} onClick={askRun}>
                Research &amp; Draft {selectedEligible.length ? `(${selectedEligible.length})` : ""}
              </Button>
            </div>
          </div>

          <div className="overflow-x-auto rounded-lg border border-border bg-white">
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-neutral-50 text-left text-xs text-muted">
                <tr>
                  <th className="w-8 px-3 py-2">
                    <input
                      type="checkbox"
                      checked={eligibleVisible.length > 0 && eligibleVisible.every((p) => selected.has(p.key))}
                      onChange={(e) => setSelected(e.target.checked ? new Set(eligibleVisible.map((p) => p.key)) : new Set())}
                      title="Select all eligible rows in view"
                    />
                  </th>
                  <th className="px-3 py-2">Name</th>
                  <th className="px-3 py-2">Title</th>
                  <th className="px-3 py-2">Company</th>
                  <th className="px-3 py-2">Owner</th>
                  <th className="px-3 py-2">Outreach</th>
                  <th className="px-3 py-2">LinkedIn</th>
                  <th className="px-3 py-2">AI status</th>
                  <th className="px-3 py-2">Flags</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((p) => (
                  <Row key={`${p.key}-${p.sheetRow}`} p={p} checked={selected.has(p.key)} onToggle={() => toggle(p.key)} canSelect={canPick(p)} progress={progress[p.key]} history={data.history[p.email.toLowerCase()]} excluded={excluded.length > 0 && !eligible(p, "Fresh pitch", excluded) && eligible(p, "Fresh pitch")} />
                ))}
                {visible.length === 0 && (
                  <tr>
                    <td colSpan={9} className="px-3 py-8 text-center text-muted">{loading ? "Loading…" : "No rows match these filters."}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-muted">
            {visible.length} shown of {prospects.length} rows. {campaign === "Fresh pitch" ? "Fresh pitch: every row except Meeting Booked, the never-contact list, and people already emailed from another tab." : "Re-engage: only rows with Outreach Status Message Done or Followed Up."}
          </p>
        </>
      )}

      {confirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
            <h2 className="mb-2 text-base font-semibold">Run Research &amp; Draft?</h2>
            <ul className="mb-4 space-y-1 text-sm text-neutral-700">
              <li><b>{confirm.rows}</b> rows, campaign <b>{campaign}</b></li>
              <li>About <b>{confirm.creditsMin}–{confirm.creditsMax}</b> Firecrawl credits and <b>{confirm.rows}</b> Claude calls (a second call only when a draft fails a check)</li>
              {confirm.redraft > 0 && <li className="text-amber-800">{confirm.redraft} of these already have a draft. It will be replaced.</li>}
              {confirm.needColumns && <li className="text-amber-800">This tab does not have the AI columns yet. 19 columns starting &quot;AI …&quot; will be added to the right of your existing columns.</li>}
            </ul>
            <div className="flex justify-end gap-2">
              <Button onClick={() => setConfirm(null)}>Cancel</Button>
              <Button variant="primary" onClick={doRun}>Start</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Filter({ label, value, onChange, values }: { label: string; value: string; onChange: (v: string) => void; values: string[] }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className="h-8 rounded-md border border-border px-2 text-sm">
      <option value={ALL}>{label}: all</option>
      <option value={EMPTY}>{label}: (empty)</option>
      {values.map((v) => (
        <option key={v} value={v}>{label}: {v}</option>
      ))}
    </select>
  );
}

const PROGRESS_LABEL: Record<string, string> = { queued: "Waiting", researching: "Researching…", drafting: "Writing…", done: "Done", failed: "Failed" };

function Row({ p, checked, onToggle, canSelect, progress, history, excluded }: { p: Prospect; checked: boolean; onToggle: () => void; canSelect: boolean; progress?: { status: string; error: string | null }; history?: ContactHistory; excluded?: boolean }) {
  const draft = p.ai["AI Draft Status"] ?? "";
  const flags = (p.ai["AI Flags"] ?? "").split(";").map((f) => f.trim()).filter(Boolean);
  const hard = flags.filter((f) => f.startsWith("FAIL:"));
  return (
    <tr className="border-b border-border last:border-0 hover:bg-neutral-50">
      <td className="px-3 py-2">
        <input type="checkbox" checked={checked} disabled={!canSelect} onChange={onToggle} />
      </td>
      <td className="px-3 py-2">
        <div className="font-medium">{p.firstName} {p.lastName}</div>
        <div className="text-xs text-muted">{p.email}</div>
      </td>
      <td className="max-w-56 truncate px-3 py-2 text-neutral-700" title={p.title}>{p.title}</td>
      <td className="px-3 py-2">{p.company}</td>
      <td className="px-3 py-2">{p.owner}</td>
      <td className="px-3 py-2">{p.outreachStatus && <Badge>{p.outreachStatus}</Badge>}</td>
      <td className="px-3 py-2 text-xs text-muted">{p.linkedinStatus}</td>
      <td className="px-3 py-2">
        {progress && progress.status !== "done" ? (
          <Badge tone={progress.status === "failed" ? "Failed" : "Researching"}>{PROGRESS_LABEL[progress.status] ?? progress.status}</Badge>
        ) : (
          draft && <Badge tone={draft}>{draft}</Badge>
        )}
      </td>
      <td className="max-w-64 px-3 py-2 text-xs">
        {excluded && <div className="font-medium text-neutral-700">Never-contact list</div>}
        {history?.email && <div className="text-violet-700">Email {history.email.status === "sent" ? "sent" : "queued"} from {history.email.tab} · {new Date(history.email.at).toLocaleDateString()}</div>}
        {progress?.error && <div className="text-red-700">{progress.error}</div>}
        {hard.length > 0 && <div className="text-red-700">{hard.length} check{hard.length > 1 ? "s" : ""} failing</div>}
        {flags.filter((f) => !f.startsWith("FAIL:")).slice(0, 3).map((f) => (
          <span key={f} className="mr-1 text-muted">{f}</span>
        ))}
      </td>
    </tr>
  );
}
