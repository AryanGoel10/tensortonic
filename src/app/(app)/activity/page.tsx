import Link from "next/link";
import { loadActivity } from "@/app/actions/activity";
import { Badge } from "@/components/ui";

export default async function ActivityPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const filters = { user: sp.user, tab: sp.tab, level: sp.level, kind: sp.kind };
  const rows = await loadActivity(filters);
  const qs = new URLSearchParams(Object.entries(filters).filter(([, v]) => v) as [string, string][]).toString();
  const users = [...new Set(rows.map((r) => r.userEmail).filter(Boolean))] as string[];
  const tabs = [...new Set(rows.map((r) => r.tab).filter(Boolean))] as string[];

  return (
    <div className="space-y-4">
      <form className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-white p-3 text-sm">
        <select name="user" defaultValue={filters.user ?? ""} className="h-8 rounded-md border border-border px-2">
          <option value="">All users</option>
          {users.map((u) => <option key={u}>{u}</option>)}
        </select>
        <select name="tab" defaultValue={filters.tab ?? ""} className="h-8 rounded-md border border-border px-2">
          <option value="">All tabs</option>
          {tabs.map((t) => <option key={t}>{t}</option>)}
        </select>
        <select name="kind" defaultValue={filters.kind ?? ""} className="h-8 rounded-md border border-border px-2">
          <option value="">All kinds</option>
          {["run", "research", "draft", "edit", "approve", "send", "linkedin", "x", "settings", "sheet", "zoho"].map((k) => <option key={k}>{k}</option>)}
        </select>
        <select name="level" defaultValue={filters.level ?? ""} className="h-8 rounded-md border border-border px-2">
          <option value="">All levels</option>
          <option value="error">Errors</option>
          <option value="warn">Warnings</option>
          <option value="info">Info</option>
        </select>
        <button className="h-8 rounded-md bg-black px-3 text-white">Filter</button>
        <Link href="/activity" className="text-muted underline">Clear</Link>
        <a href={`/api/activity/csv${qs ? `?${qs}` : ""}`} className="ml-auto h-8 rounded-md border border-border px-3 leading-8">Export CSV</a>
      </form>
      <div className="overflow-x-auto rounded-lg border border-border bg-white">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-neutral-50 text-left text-xs text-muted">
            <tr><th className="px-3 py-2">When</th><th className="px-3 py-2">Who</th><th className="px-3 py-2">Kind</th><th className="px-3 py-2">Tab</th><th className="px-3 py-2">Row</th><th className="px-3 py-2">What happened</th></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-border last:border-0 align-top">
                <td className="whitespace-nowrap px-3 py-1.5 text-xs text-muted">{new Date(r.at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}</td>
                <td className="px-3 py-1.5 text-xs">{r.userEmail ?? "system"}</td>
                <td className="px-3 py-1.5"><Badge tone={r.level === "error" ? "Failed" : r.level === "warn" ? "Needs review" : undefined}>{r.kind}</Badge></td>
                <td className="px-3 py-1.5 text-xs">{r.tab}</td>
                <td className="max-w-48 truncate px-3 py-1.5 text-xs text-muted" title={r.rowKey ?? ""}>{r.rowKey}</td>
                <td className="px-3 py-1.5 text-xs">{r.message}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={6} className="px-3 py-8 text-center text-muted">No activity yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
