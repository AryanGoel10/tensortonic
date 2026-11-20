import { db, schema } from "@/db";

export interface LogInput {
  userEmail?: string | null;
  level?: "info" | "warn" | "error";
  kind: string;
  spreadsheetId?: string | null;
  tab?: string | null;
  rowKey?: string | null;
  message: string;
  meta?: Record<string, unknown>;
}

/** Write to the activity log. Never throws: logging must not break the flow it records. */
export async function log(entry: LogInput) {
  const line = `[${entry.level ?? "info"}] ${entry.kind} ${entry.rowKey ?? ""} ${entry.message}`;
  if (entry.level === "error") console.error(line, entry.meta ?? "");
  else console.log(line);
  try {
    await db()
      .insert(schema.activity)
      .values({
        userEmail: entry.userEmail ?? null,
        level: entry.level ?? "info",
        kind: entry.kind,
        spreadsheetId: entry.spreadsheetId ?? null,
        tab: entry.tab ?? null,
        rowKey: entry.rowKey ?? null,
        message: entry.message.slice(0, 2000),
        meta: entry.meta ?? null,
      });
  } catch (err) {
    console.error("activity log write failed", err);
  }
}

export function errMsg(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
