import type { Prospect } from "@/lib/sheets/mapping";
import type { Campaign, RunCampaign } from "@/lib/types";

export function isExcludedCompany(company: string, excluded: string[]): boolean {
  const c = company.trim().toLowerCase();
  return excluded.some((x) => x.trim() && c.includes(x.trim().toLowerCase()));
}

/** Already emailed by the team before (per the sheet's Outreach Status). */
export function wasContacted(p: Pick<Prospect, "outreachStatus">): boolean {
  const s = p.outreachStatus.trim().toLowerCase();
  return s === "message done" || s === "followed up";
}

/** Auto: re-engage people who were emailed before, first-touch everyone else. */
export function resolveCampaign(p: Prospect, chosen: RunCampaign): Campaign {
  if (chosen !== "Auto") return chosen;
  return wasContacted(p) ? "Re-engage" : "Fresh pitch";
}

export function eligible(p: Prospect, campaign: RunCampaign, excluded: string[] = []): boolean {
  const s = p.outreachStatus.trim().toLowerCase();
  if (s === "meeting booked") return false;
  if (!p.email || !p.company) return false;
  if (isExcludedCompany(p.company, excluded)) return false;
  if (campaign === "Re-engage") return wasContacted(p);
  return true; // Fresh pitch and Auto: everyone not booked or excluded
}
