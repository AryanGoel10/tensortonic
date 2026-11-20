export type Campaign = "Fresh pitch" | "Re-engage";

export interface ResearchItem {
  kind: "launch" | "changelog" | "blog" | "funding" | "news" | "docs" | "page";
  title: string;
  url: string;
  date?: string;
  snippet: string;
}

export interface XCandidate {
  url: string;
  handle: string;
  confidence: "high" | "medium" | "low";
  evidence: string;
}

export interface ResearchPack {
  company: string;
  website: string;
  homepageUrl?: string;
  homepageSummary: string; // trimmed markdown from homepage
  extraPages: { url: string; title: string; markdown: string }[];
  recent: ResearchItem[];
  docsUrl?: string;
  companyX?: string;
  personX?: XCandidate | null;
  categoryReason: string;
  urls: string[]; // every URL the model may cite
  flags: string[];
  creditsUsed: number;
}

export interface Draft {
  research_summary: string;
  hook: string;
  hook_source_url: string;
  challenge_idea: string;
  email_subject: string;
  email_body: string;
  linkedin_note: string;
  x_dm: string;
  confidence: "high" | "medium" | "low";
  flags: string[];
}

export type DraftStatus =
  | "Researching"
  | "Drafted"
  | "Needs review"
  | "Approved"
  | "Queued"
  | "Emailed"
  | "Failed"
  | "Rejected"
  | "Skipped";
