import {
  pgTable,
  text,
  timestamp,
  jsonb,
  integer,
  serial,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// Team accounts (username + password). Prospect data never lives here; it stays in Google Sheets.
// `email` holds the login username (lowercase); the column name is kept for compatibility.
export const users = pgTable("users", {
  email: text("email").primaryKey(),
  name: text("name"),
  image: text("image"),
  passwordHash: text("password_hash"),
  contactEmail: text("contact_email"), // where "Send test to me" goes
  failedLogins: integer("failed_logins").notNull().default(0),
  lockedUntil: timestamp("locked_until", { withTimezone: true }),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).defaultNow().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// One row per connected Zoho mailbox. Refresh token is AES-256-GCM encrypted.
export const zohoAccounts = pgTable("zoho_accounts", {
  userEmail: text("user_email").primaryKey(),
  accountId: text("account_id").notNull(),
  fromAddress: text("from_address").notNull(),
  displayName: text("display_name"),
  refreshTokenEnc: text("refresh_token_enc").notNull(),
  accessTokenEnc: text("access_token_enc"),
  accessExpiresAt: timestamp("access_expires_at", { withTimezone: true }),
  connectedAt: timestamp("connected_at", { withTimezone: true }).defaultNow().notNull(),
});

export const connectedSheets = pgTable("connected_sheets", {
  spreadsheetId: text("spreadsheet_id").primaryKey(),
  title: text("title").notNull(),
  addedBy: text("added_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// Editable settings (prompt, templates, deck link, caps, toggles). Value is JSON.
export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedBy: text("updated_by"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const settingsHistory = pgTable(
  "settings_history",
  {
    id: serial("id").primaryKey(),
    key: text("key").notNull(),
    value: jsonb("value").notNull(),
    updatedBy: text("updated_by"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("settings_history_key_idx").on(t.key, t.updatedAt)],
);

// A Research & Draft run over many rows.
export const jobRuns = pgTable("job_runs", {
  id: text("id").primaryKey(),
  spreadsheetId: text("spreadsheet_id").notNull(),
  tab: text("tab").notNull(),
  campaign: text("campaign").notNull(),
  total: integer("total").notNull(),
  startedBy: text("started_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// Per-row progress for a run (drives the live progress column).
export const jobItems = pgTable(
  "job_items",
  {
    id: serial("id").primaryKey(),
    runId: text("run_id").notNull(),
    rowKey: text("row_key").notNull(),
    status: text("status").notNull(), // queued | researching | drafting | done | failed
    error: text("error"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex("job_items_run_row_idx").on(t.runId, t.rowKey)],
);

// The research behind a draft. Kept so the validator can check hook URLs and numbers
// when someone edits a draft later, and so reviewers can see sources.
export const researchPacks = pgTable(
  "research_packs",
  {
    id: serial("id").primaryKey(),
    spreadsheetId: text("spreadsheet_id").notNull(),
    tab: text("tab").notNull(),
    rowKey: text("row_key").notNull(),
    pack: jsonb("pack").notNull(),
    draft: jsonb("draft"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex("research_packs_row_idx").on(t.spreadsheetId, t.tab, t.rowKey)],
);

export const sendQueue = pgTable(
  "send_queue",
  {
    id: text("id").primaryKey(),
    spreadsheetId: text("spreadsheet_id").notNull(),
    tab: text("tab").notNull(),
    rowKey: text("row_key").notNull(),
    campaign: text("campaign").notNull(),
    senderEmail: text("sender_email").notNull(), // owner of the Zoho mailbox used
    toEmail: text("to_email").notNull(),
    subject: text("subject").notNull(),
    body: text("body").notNull(),
    kind: text("kind").notNull().default("prospect"), // prospect | test
    status: text("status").notNull(), // queued | sending | sent | dry_run | cancelled | failed
    zohoMessageId: text("zoho_message_id"),
    error: text("error"),
    queuedBy: text("queued_by").notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("send_queue_sender_idx").on(t.senderEmail, t.sentAt)],
);

export const activity = pgTable(
  "activity",
  {
    id: serial("id").primaryKey(),
    at: timestamp("at", { withTimezone: true }).defaultNow().notNull(),
    userEmail: text("user_email"),
    level: text("level").notNull().default("info"), // info | warn | error
    kind: text("kind").notNull(), // run | research | draft | edit | approve | send | linkedin | x | settings | sheet | zoho
    spreadsheetId: text("spreadsheet_id"),
    tab: text("tab"),
    rowKey: text("row_key"),
    message: text("message").notNull(),
    meta: jsonb("meta"),
  },
  (t) => [index("activity_at_idx").on(t.at)],
);
