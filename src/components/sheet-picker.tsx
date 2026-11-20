"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import Link from "next/link";
import { getTabs, listSheets } from "@/app/actions/sheets";

const LS_KEY = "tt-outreach:selection";

export function useSelection() {
  const params = useSearchParams();
  return { sheet: params.get("sheet") ?? "", tab: params.get("tab") ?? "" };
}

export function SheetPicker({ onRefresh, right }: { onRefresh?: () => void; right?: React.ReactNode }) {
  const router = useRouter();
  const path = usePathname();
  const { sheet, tab } = useSelection();
  const [sheets, setSheets] = useState<{ spreadsheetId: string; title: string }[] | null>(null);
  const [tabs, setTabs] = useState<string[]>([]);
  const [error, setError] = useState("");

  const go = (s: string, t: string) => {
    const q = new URLSearchParams();
    if (s) q.set("sheet", s);
    if (t) q.set("tab", t);
    try {
      localStorage.setItem(LS_KEY, JSON.stringify({ sheet: s, tab: t }));
    } catch {}
    router.replace(`${path}?${q}`);
  };

  useEffect(() => {
    listSheets()
      .then((rows) => {
        setSheets(rows);
        if (!sheet) {
          let saved: { sheet?: string; tab?: string } = {};
          try {
            saved = JSON.parse(localStorage.getItem(LS_KEY) ?? "{}");
          } catch {}
          const pick = rows.find((r) => r.spreadsheetId === saved.sheet) ?? rows[0];
          if (pick) go(pick.spreadsheetId, pick.spreadsheetId === saved.sheet ? saved.tab ?? "" : "");
        }
      })
      .catch((e) => setError(String(e.message ?? e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!sheet) return;
    setTabs([]);
    getTabs(sheet)
      .then(setTabs)
      .catch((e) => setError(String(e.message ?? e)));
  }, [sheet]);

  if (sheets && sheets.length === 0)
    return (
      <div className="rounded-md border border-border bg-white px-4 py-3 text-sm">
        No sheets connected yet. <Link href="/settings" className="font-medium underline">Connect one in Settings</Link>.
      </div>
    );

  return (
    <div className="flex flex-wrap items-center gap-2">
      <select value={sheet} onChange={(e) => go(e.target.value, "")} className="h-9 rounded-md border border-border bg-white px-2 text-sm">
        {!sheet && <option value="">Choose a sheet</option>}
        {(sheets ?? []).map((s) => (
          <option key={s.spreadsheetId} value={s.spreadsheetId}>{s.title}</option>
        ))}
      </select>
      <select value={tab} onChange={(e) => go(sheet, e.target.value)} className="h-9 min-w-48 rounded-md border border-border bg-white px-2 text-sm" disabled={!tabs.length}>
        <option value="">{tabs.length ? "Choose a tab" : "Loading tabs…"}</option>
        {tabs.map((t) => (
          <option key={t} value={t}>{t}</option>
        ))}
      </select>
      {onRefresh && tab && (
        <button onClick={onRefresh} className="h-9 rounded-md border border-border bg-white px-3 text-sm hover:bg-neutral-50">Refresh</button>
      )}
      {error && <span className="text-sm text-red-700">{error}</span>}
      <div className="ml-auto flex items-center gap-2">{right}</div>
    </div>
  );
}
