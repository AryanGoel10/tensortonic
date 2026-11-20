import type Firecrawl from "@mendable/firecrawl-js";
import type { Prospect } from "@/lib/sheets/mapping";
import type { XCandidate } from "@/lib/types";

const RESERVED = new Set(["i", "home", "search", "intent", "share", "hashtag", "explore", "settings", "login", "signup", "messages", "notifications", "tos", "privacy", "compose"]);

export interface SearchHit {
  url: string;
  title?: string;
  description?: string;
}

export function handleFromUrl(url: string): string | null {
  const m = url.match(/^https?:\/\/(?:www\.|mobile\.)?(?:x|twitter)\.com\/([A-Za-z0-9_]{1,15})(?:[/?#]|$)/i);
  if (!m) return null;
  const h = m[1];
  if (RESERVED.has(h.toLowerCase())) return null;
  return h;
}

const ROLE_WORDS = ["founder", "co-founder", "cofounder", "ceo", "cto", "cpo", "coo", "vp", "head", "engineer", "engineering", "scientist", "research", "researcher", "developer", "devrel", "staff", "principal", "lead", "director", "ml", "ai"];

function roleKeywords(title: string): string[] {
  const t = title.toLowerCase();
  return ROLE_WORDS.filter((w) => new RegExp(`(^|[^a-z])${w}([^a-z]|$)`).test(t));
}

/**
 * Score one search hit. Requires the person's full name in the title/snippet.
 * high: name + company; medium: name + role keyword (or handle contains last name with role);
 * low: name only. Returns null when the name isn't there (never guess from name patterns).
 */
export function scoreHit(hit: SearchHit, p: Pick<Prospect, "firstName" | "lastName" | "title">, company: string, companyHandle?: string): XCandidate | null {
  const handle = handleFromUrl(hit.url);
  if (!handle) return null;
  if (companyHandle && handle.toLowerCase() === companyHandle.toLowerCase()) return null;

  const text = `${hit.title ?? ""} ${hit.description ?? ""}`.toLowerCase();
  const first = p.firstName.toLowerCase().trim();
  const last = p.lastName.toLowerCase().trim();
  if (!first || !last) return null;
  const nameHit = text.includes(`${first} ${last}`) || (text.includes(first) && text.includes(last));
  if (!nameHit) return null;

  const companyCore = company.toLowerCase().replace(/[^a-z0-9 ]/g, "").split(" ").filter((w) => w.length > 2);
  const companyHit = companyCore.length > 0 && companyCore.every((w) => text.includes(w));
  const roles = roleKeywords(p.title).filter((r) => r.length > 2 && text.includes(r));

  const url = `https://x.com/${handle}`;
  if (companyHit) return { url, handle, confidence: "high", evidence: `Profile mentions "${company}"` };
  if (roles.length) return { url, handle, confidence: "medium", evidence: `Name + role match (${roles.join(", ")})` };
  return { url, handle, confidence: "low", evidence: "Name match only. Confirm before messaging." };
}

const RANK = { high: 3, medium: 2, low: 1 } as const;

export async function findPersonX(
  fc: Firecrawl,
  p: Prospect,
  company: string,
): Promise<{ candidate: XCandidate | null; credits: number }> {
  if (!p.firstName || !p.lastName) return { candidate: null, credits: 0 };
  const companyHandle = p.companyTwitter ? handleFromUrl(p.companyTwitter) ?? undefined : undefined;
  let credits = 0;

  const run = async (q: string) => {
    const res = await fc.search(q, { limit: 5, sources: ["web"], domainTools: false, timeout: 30_000 });
    credits += 2;
    return ((res.web ?? []) as SearchHit[]).filter((h) => h.url);
  };

  const best = (hits: SearchHit[]) => {
    let top: XCandidate | null = null;
    for (const h of hits) {
      const c = scoreHit(h, p, company, companyHandle);
      if (c && (!top || RANK[c.confidence] > RANK[top.confidence])) top = c;
    }
    return top;
  };

  const primary = best(await run(`"${p.firstName} ${p.lastName}" "${company}" (site:x.com OR site:twitter.com)`));
  if (primary && primary.confidence !== "low") return { candidate: primary, credits };

  const kw = roleKeywords(p.title).slice(0, 2).join(" ");
  const fallback = best(await run(`"${p.firstName} ${p.lastName}" ${kw} (site:x.com OR site:twitter.com)`.replace(/\s+/g, " ")));
  const pick = [primary, fallback].filter(Boolean).sort((a, b) => RANK[b!.confidence] - RANK[a!.confidence])[0] ?? null;
  return { candidate: pick, credits };
}
