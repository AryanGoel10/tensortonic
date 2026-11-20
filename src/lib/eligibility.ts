import type { Prospect } from "@/lib/sheets/mapping";
import type { Campaign } from "@/lib/types";

export function isExcludedCompany(company: string, excluded: string[]): boolean {
  const c = company.trim().toLowerCase();
  return excluded.some((x) => x.trim() && c.includes(x.trim().toLowerCase()));
}

export function eligible(p: Prospect, campaign: Campaign, excluded: string[] = []): boolean {
  const s = p.outreachStatus.trim().toLowerCase();
  if (s === "meeting booked") return false;
  if (!p.email || !p.company) return false;
  if (isExcludedCompany(p.company, excluded)) return false;
  if (campaign === "Re-engage") return s === "message done" || s === "followed up";
  return true; // Fresh pitch: every contact gets the new post-Gradium pitch
}
