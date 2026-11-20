// Pure header-mapping and row-identity logic. No network calls here so it is unit tested.

export const AI_COLUMNS = [
  "AI Draft Status",
  "AI Campaign",
  "AI Research Summary",
  "AI Sources",
  "AI Hook",
  "AI Challenge Idea",
  "AI Email Subject",
  "AI Email Body",
  "AI LinkedIn Note",
  "AI X DM",
  "AI Person X URL",
  "AI X Confidence",
  "AI Flags",
  "AI Last Run",
  "AI Email Sent At",
  "AI Email Sent By",
  "AI Zoho Message ID",
  "AI LinkedIn Sent At",
  "AI X Sent At",
] as const;
export type AiColumn = (typeof AI_COLUMNS)[number];

// The only team-owned columns the tool may write (spec 5.3).
export const TEAM_WRITABLE = ["Outreach Status", "Owner", "Linkedin"] as const;
export type TeamColumn = (typeof TEAM_WRITABLE)[number];
export type WritableColumn = AiColumn | TeamColumn;

export type Field =
  | "outreachStatus"
  | "owner"
  | "linkedinStatus"
  | "firstName"
  | "lastName"
  | "name"
  | "title"
  | "company"
  | "email"
  | "department"
  | "personLinkedin"
  | "website"
  | "companyLinkedin"
  | "twitter"
  | "categoryReason";

const ALIASES: Record<Exclude<Field, "categoryReason">, string[]> = {
  outreachStatus: ["outreach status"],
  owner: ["owner"],
  linkedinStatus: ["linkedin"],
  firstName: ["first name"],
  lastName: ["last name"],
  name: ["name"],
  title: ["title"],
  company: ["company name", "company"],
  email: ["email", "to"],
  department: ["departments"],
  personLinkedin: ["person linkedin url"],
  website: ["website"],
  companyLinkedin: ["company linkedin url"],
  twitter: ["twitter url"],
};

const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

export interface HeaderMap {
  fields: Partial<Record<Field, number>>;
  ai: Partial<Record<AiColumn, number>>;
  team: Partial<Record<TeamColumn, number>>;
  headers: string[];
  missingAi: AiColumn[];
  warnings: string[];
  canDraft: boolean;
}

export function mapHeaders(headerRow: string[]): HeaderMap {
  const headers = headerRow.map((h) => (h ?? "").toString());
  const normed = headers.map(norm);
  const fields: Partial<Record<Field, number>> = {};

  for (const [field, aliases] of Object.entries(ALIASES) as [Field, string[]][]) {
    for (const alias of aliases) {
      const idx = normed.indexOf(alias);
      if (idx !== -1) {
        fields[field] = idx;
        break;
      }
    }
  }
  const reasonIdx = normed.findIndex((h) => h.startsWith("why it is"));
  if (reasonIdx !== -1) fields.categoryReason = reasonIdx;

  const ai: Partial<Record<AiColumn, number>> = {};
  for (const col of AI_COLUMNS) {
    const idx = normed.indexOf(norm(col));
    if (idx !== -1) ai[col] = idx;
  }
  const team: Partial<Record<TeamColumn, number>> = {};
  for (const col of TEAM_WRITABLE) {
    const idx = normed.indexOf(norm(col));
    if (idx !== -1) team[col] = idx;
  }

  const warnings: string[] = [];
  if (fields.email === undefined) warnings.push("No Email / To column. Drafting is disabled for this tab.");
  if (fields.company === undefined) warnings.push("No Company Name / Company column. Drafting is disabled for this tab.");
  if (fields.firstName === undefined && fields.name === undefined)
    warnings.push("No First Name or Name column. Greetings can't be personalised.");
  if (fields.website === undefined) warnings.push("No Website column. Research will rely on search only.");

  return {
    fields,
    ai,
    team,
    headers,
    missingAi: AI_COLUMNS.filter((c) => ai[c] === undefined),
    warnings,
    canDraft: fields.email !== undefined && fields.company !== undefined,
  };
}

export interface Prospect {
  key: string;
  sheetRow: number; // 1-based row number at read time. Display only; never stored.
  outreachStatus: string;
  owner: string;
  linkedinStatus: string;
  firstName: string;
  lastName: string;
  title: string;
  company: string;
  email: string;
  department: string;
  personLinkedin: string;
  website: string;
  companyLinkedin: string;
  companyTwitter: string; // existing "Twitter Url" is usually the company handle
  categoryReason: string;
  ai: Partial<Record<AiColumn, string>>;
}

export function rowKey(email: string, company: string): string {
  return `${email.trim().toLowerCase()}|${company.trim().toLowerCase()}`;
}

export function parseRows(values: string[][], map: HeaderMap): Prospect[] {
  const get = (row: string[], f: Field) => {
    const i = map.fields[f];
    return i === undefined ? "" : (row[i] ?? "").toString().trim();
  };
  const out: Prospect[] = [];
  for (let r = 1; r < values.length; r++) {
    const row = values[r] ?? [];
    const email = get(row, "email");
    const company = get(row, "company");
    if (!email && !company && !get(row, "name") && !get(row, "firstName")) continue; // blank row

    let firstName = get(row, "firstName");
    let lastName = get(row, "lastName");
    if (!firstName && map.fields.name !== undefined) {
      const parts = get(row, "name").split(/\s+/).filter(Boolean);
      firstName = parts[0] ?? "";
      if (!lastName) lastName = parts.slice(1).join(" ");
    }

    const ai: Partial<Record<AiColumn, string>> = {};
    for (const [col, idx] of Object.entries(map.ai) as [AiColumn, number][]) {
      ai[col] = (row[idx] ?? "").toString();
    }

    out.push({
      key: rowKey(email, company),
      sheetRow: r + 1,
      outreachStatus: get(row, "outreachStatus"),
      owner: get(row, "owner"),
      linkedinStatus: get(row, "linkedinStatus"),
      firstName,
      lastName,
      title: get(row, "title"),
      company,
      email,
      department: get(row, "department"),
      personLinkedin: get(row, "personLinkedin"),
      website: get(row, "website"),
      companyLinkedin: get(row, "companyLinkedin"),
      companyTwitter: get(row, "twitter"),
      categoryReason: get(row, "categoryReason"),
      ai,
    });
  }
  return out;
}

/** Find a row by key. Returns null when the key is missing or ambiguous (spec 4.3). */
export function locate(prospects: Prospect[], key: string): { prospect: Prospect | null; matches: number } {
  const hits = prospects.filter((p) => p.key === key);
  return { prospect: hits.length === 1 ? hits[0] : null, matches: hits.length };
}

/** Column index → A1 letters (0 → A, 26 → AA). */
export function colLetter(idx: number): string {
  let n = idx + 1;
  let s = "";
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

export function quoteTab(tab: string): string {
  return `'${tab.replace(/'/g, "''")}'`;
}

/** Was the person already contacted on LinkedIn? Column holds "None" or a name. */
export function alreadyOnLinkedin(p: Pick<Prospect, "linkedinStatus">): boolean {
  const v = p.linkedinStatus.trim().toLowerCase();
  return v !== "" && v !== "none";
}

export function extractSpreadsheetId(input: string): string | null {
  const m = input.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (m) return m[1];
  if (/^[a-zA-Z0-9-_]{25,}$/.test(input.trim())) return input.trim();
  return null;
}
