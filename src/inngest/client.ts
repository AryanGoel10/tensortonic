import { Inngest } from "inngest";

export const inngest = new Inngest({ id: "tt-outreach" });

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
