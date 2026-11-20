import { NextResponse } from "next/server";
import { and, desc, eq, type SQL } from "drizzle-orm";
import { auth } from "@/auth";
import { isAllowed } from "@/lib/allowlist";
import { db, schema } from "@/db";

const esc = (v: unknown) => {
  const s = v === null || v === undefined ? "" : typeof v === "string" ? v : v instanceof Date ? v.toISOString() : JSON.stringify(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export async function GET(req: Request) {
  const session = await auth();
  if (!isAllowed(session?.user?.email)) return new NextResponse("Unauthorized", { status: 401 });
  const u = new URL(req.url);
  const where: SQL[] = [];
  for (const [param, col] of [["user", schema.activity.userEmail], ["tab", schema.activity.tab], ["level", schema.activity.level], ["kind", schema.activity.kind]] as const) {
    const v = u.searchParams.get(param);
    if (v) where.push(eq(col, v));
  }
  const rows = await db().select().from(schema.activity).where(where.length ? and(...where) : undefined).orderBy(desc(schema.activity.at)).limit(10000);
  const header = ["at", "user", "level", "kind", "tab", "row_key", "message", "meta"];
  const lines = [header.join(","), ...rows.map((r) => [r.at, r.userEmail, r.level, r.kind, r.tab, r.rowKey, r.message, r.meta].map(esc).join(","))];
  return new NextResponse(lines.join("\n"), {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="tt-outreach-activity-${new Date().toISOString().slice(0, 10)}.csv"` },
  });
}
