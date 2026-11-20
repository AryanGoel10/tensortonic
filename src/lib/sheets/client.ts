import { google, sheets_v4 } from "googleapis";
import {
  AI_COLUMNS,
  colLetter,
  locate,
  mapHeaders,
  parseRows,
  quoteTab,
  type HeaderMap,
  type Prospect,
  type WritableColumn,
  AiColumn,
  TEAM_WRITABLE,
} from "./mapping";

let _sheets: sheets_v4.Sheets | null = null;
let _saEmail = "";

function serviceAccount(): { client_email: string; private_key: string } {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON is not set");
  const json = raw.trim().startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8");
  return JSON.parse(json);
}

export function serviceAccountEmail(): string {
  if (!_saEmail) {
    try {
      _saEmail = serviceAccount().client_email;
    } catch {
      return "(service account not configured)";
    }
  }
  return _saEmail;
}

function api(): sheets_v4.Sheets {
  if (!_sheets) {
    const sa = serviceAccount();
    _saEmail = sa.client_email;
    const auth = new google.auth.JWT({
      email: sa.client_email,
      key: sa.private_key,
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });
    _sheets = google.sheets({ version: "v4", auth });
  }
  return _sheets;
}

/** Retry on 429 / 5xx with exponential backoff (Sheets quota is per minute). */
async function withBackoff<T>(fn: () => Promise<T>, tries = 6): Promise<T> {
  let delay = 1000;
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (err: unknown) {
      const code = (err as { code?: number; status?: number }).code ?? (err as { status?: number }).status;
      if (i >= tries - 1 || !(code === 429 || (typeof code === "number" && code >= 500))) throw err;
      await new Promise((r) => setTimeout(r, delay + Math.random() * 500));
      delay *= 2;
    }
  }
}

export interface SheetInfo {
  title: string;
  tabs: { title: string; sheetId: number; columnCount: number }[];
}

export async function getSpreadsheetInfo(spreadsheetId: string): Promise<SheetInfo> {
  const res = await withBackoff(() =>
    api().spreadsheets.get({
      spreadsheetId,
      fields: "properties.title,sheets.properties(title,sheetId,gridProperties.columnCount)",
    }),
  );
  return {
    title: res.data.properties?.title ?? spreadsheetId,
    tabs: (res.data.sheets ?? []).map((s) => ({
      title: s.properties?.title ?? "",
      sheetId: s.properties?.sheetId ?? 0,
      columnCount: s.properties?.gridProperties?.columnCount ?? 0,
    })),
  };
}

export interface TabData {
  map: HeaderMap;
  prospects: Prospect[];
}

export async function readTab(spreadsheetId: string, tab: string): Promise<TabData> {
  const res = await withBackoff(() =>
    api().spreadsheets.values.get({
      spreadsheetId,
      range: quoteTab(tab),
      valueRenderOption: "FORMATTED_VALUE",
    }),
  );
  const values = (res.data.values ?? []) as string[][];
  const map = mapHeaders(values[0] ?? []);
  return { map, prospects: parseRows(values, map) };
}

/** Append any missing AI columns to the right of the existing header row. */
export async function ensureAiColumns(spreadsheetId: string, tab: string): Promise<AiColumn[]> {
  const info = await getSpreadsheetInfo(spreadsheetId);
  const t = info.tabs.find((x) => x.title === tab);
  if (!t) throw new Error(`Tab "${tab}" not found`);
  const { map } = await readTab(spreadsheetId, tab);
  const missing = map.missingAi;
  if (missing.length === 0) return [];

  const start = map.headers.length;
  const needed = start + missing.length;
  if (needed > t.columnCount) {
    await withBackoff(() =>
      api().spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [
            {
              appendDimension: { sheetId: t.sheetId, dimension: "COLUMNS", length: needed - t.columnCount },
            },
          ],
        },
      }),
    );
  }
  await withBackoff(() =>
    api().spreadsheets.values.update({
      spreadsheetId,
      range: `${quoteTab(tab)}!${colLetter(start)}1:${colLetter(needed - 1)}1`,
      valueInputOption: "RAW",
      requestBody: { values: [missing as unknown as string[]] },
    }),
  );
  return missing;
}

export class RowWriteError extends Error {
  constructor(
    message: string,
    public readonly code: "not_found" | "ambiguous" | "missing_columns",
  ) {
    super(message);
  }
}

const ALLOWED = new Set<string>([...AI_COLUMNS, ...TEAM_WRITABLE]);

/**
 * Re-locate a row by key right before writing (rows move when people sort),
 * then write only allowed columns. Never writes when the key is missing or matches 2+ rows.
 */
export async function writeRow(
  spreadsheetId: string,
  tab: string,
  key: string,
  values: Partial<Record<WritableColumn, string>>,
): Promise<Prospect> {
  for (const col of Object.keys(values)) {
    if (!ALLOWED.has(col)) throw new Error(`Refusing to write to non-tool column "${col}"`);
  }
  const { map, prospects } = await readTab(spreadsheetId, tab);
  const { prospect, matches } = locate(prospects, key);
  if (!prospect) {
    throw new RowWriteError(
      matches === 0
        ? `Row ${key} not found in "${tab}". It may have been edited or deleted.`
        : `Row ${key} matches ${matches} rows in "${tab}". Fix the duplicate before continuing.`,
      matches === 0 ? "not_found" : "ambiguous",
    );
  }
  const data: sheets_v4.Schema$ValueRange[] = [];
  const missing: string[] = [];
  for (const [col, val] of Object.entries(values) as [WritableColumn, string][]) {
    const idx =
      (map.ai as Record<string, number | undefined>)[col] ??
      (map.team as Record<string, number | undefined>)[col];
    if (idx === undefined) {
      missing.push(col);
      continue;
    }
    data.push({
      range: `${quoteTab(tab)}!${colLetter(idx)}${prospect.sheetRow}`,
      values: [[val ?? ""]],
    });
  }
  if (missing.length && data.length === 0) {
    throw new RowWriteError(`Columns missing in "${tab}": ${missing.join(", ")}`, "missing_columns");
  }
  if (data.length) {
    await withBackoff(() =>
      api().spreadsheets.values.batchUpdate({
        spreadsheetId,
        requestBody: { valueInputOption: "RAW", data },
      }),
    );
  }
  return prospect;
}

/** Read the current state of one row by key (used for pre-send re-checks). */
export async function readRow(spreadsheetId: string, tab: string, key: string) {
  const { prospects } = await readTab(spreadsheetId, tab);
  return locate(prospects, key);
}
