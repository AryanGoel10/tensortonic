import { Inngest } from "inngest";

// TT_INNGEST_* (keys copied from your own Inngest dashboard) win over the INNGEST_* values
// the Vercel integration injects, in case the integration created a separate Inngest account.
export const inngest = new Inngest({
  id: "tt-outreach",
  signingKey: process.env.TT_INNGEST_SIGNING_KEY || process.env.INNGEST_SIGNING_KEY,
  eventKey: process.env.TT_INNGEST_EVENT_KEY || process.env.INNGEST_EVENT_KEY,
});

export const EVENTS = {
  researchRow: "outreach/row.research",
  sendEmail: "outreach/email.send",
} as const;

export interface ResearchRowData {
  runId: string;
  spreadsheetId: string;
  tab: string;
  key: string;
  campaign: "Fresh pitch" | "Re-engage";
  user: string;
}

export interface SendEmailData {
  queueId: string;
  sender: string;
}
