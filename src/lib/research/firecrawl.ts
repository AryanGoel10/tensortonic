import Firecrawl from "@mendable/firecrawl-js";
import type { Prospect } from "@/lib/sheets/mapping";
import type { ResearchItem, ResearchPack } from "@/lib/types";
import { findPersonX } from "./xfinder";

let _fc: Firecrawl | null = null;
export function firecrawl(): Firecrawl {
  if (!_fc) {
    const apiKey = process.env.FIRECRAWL_API_KEY;
    if (!apiKey) throw new Error("FIRECRAWL_API_KEY is not set");
    _fc = new Firecrawl({ apiKey });
  }
  return _fc;
}

// Rough budget: ~4 chars per token, ~6k tokens total.
const HOMEPAGE_CHARS = 10_000;
const EXTRA_PAGE_CHARS = 5_000;
const TOTAL_CHARS = 24_000;

/** Estimated Firecrawl credits per row, shown in the UI before a run. */
export const CREDITS_PER_ROW_ESTIMATE = { min: 5, max: 8 };

export function cleanCompanyName(name: string): string {
  return name.replace(/\(.*?\)/g, "").replace(/\b(inc|llc|ltd|corp|gmbh)\.?$/i, "").trim();
}

export function normalizeUrl(u: string): string {
  let s = u.trim();
  if (!s) return "";
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  return s.replace(/^http:\/\//i, "https://");
}

/** Strip images, collapse links to their text and drop nav-like lines, so tokens go to content. */
export function cleanMarkdown(md: string): string {
  return md
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\((?:[^()]|\([^)]*\))*\)/g, "$1")
    .split("\n")
    .map((l) => l.trimEnd())
    .filter((l) => {
      const t = l.trim();
      if (!t) return true;
      if (t.length < 3) return false;
      if (/^(skip to|cookie|accept all|log in|sign in|sign up|©)/i.test(t)) return false;
      return true;
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function pickExtraPages(links: { url: string; title?: string }[], site: string): { url: string; title: string }[] {
  const host = (() => {
    try {
      return new URL(site).hostname.replace(/^www\./, "");
    } catch {
      return "";
    }
  })();
  const sameSite = links.filter((l) => {
    try {
      const h = new URL(l.url).hostname.replace(/^www\./, "");
      return h === host || h.endsWith(`.${host}`);
    } catch {
      return false;
    }
  });
  const score = (u: string) => {
    const p = u.toLowerCase();
    if (/\/changelog\/?$|\/release-notes\/?$|\/whats-new\/?$/.test(p)) return 10;
    if (/\/blog\/?$|\/news\/?$/.test(p)) return 8;
    if (/\/(docs|documentation)\/?$|\/quickstart|getting-started/.test(p) || /^https?:\/\/docs\./.test(p)) return 7;
    if (/\/(blog|changelog|news)\/[^/]+/.test(p)) return 6; // individual post
    if (/\/(sdk|api|developers?)\/?$/.test(p)) return 5;
    return 0;
  };
  const ranked = sameSite
    .map((l) => ({ url: l.url, title: l.title ?? "", s: score(l.url) }))
    .filter((l) => l.s > 0)
    .sort((a, b) => b.s - a.s);
  // at most one of each kind
  const out: { url: string; title: string }[] = [];
  const kinds = new Set<string>();
  for (const l of ranked) {
    const kind = /changelog|release|whats-new/.test(l.url) ? "changelog" : /docs|quickstart|getting-started/.test(l.url) ? "docs" : /blog|news/.test(l.url) ? "blog" : "other";
    if (kinds.has(kind)) continue;
    kinds.add(kind);
    out.push({ url: l.url, title: l.title });
    if (out.length === 2) break;
  }
  return out;
}

function dateRangeTbs(days: number): string {
  const end = new Date();
  const start = new Date(end.getTime() - days * 86_400_000);
  const f = (d: Date) => `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
  return `cdr:1,cd_min:${f(start)},cd_max:${f(end)}`;
}

function classify(title: string, snippet: string): ResearchItem["kind"] {
  const t = `${title} ${snippet}`.toLowerCase();
  if (/raises|funding|series [a-d]|seed round|led by/.test(t)) return "funding";
  if (/launch|introduc|announc|now available|release|unveil/.test(t)) return "launch";
  if (/changelog|release notes/.test(t)) return "changelog";
  if (/blog/.test(t)) return "blog";
  return "news";
}

type Logger = (msg: string, meta?: Record<string, unknown>) => Promise<void> | void;

export async function buildResearchPack(p: Prospect, onError: Logger): Promise<ResearchPack> {
  const fc = firecrawl();
  const company = cleanCompanyName(p.company);
  const website = normalizeUrl(p.website);
  const flags: string[] = [];
  let credits = 0;

  let homepageSummary = "";
  let homepageUrl: string | undefined;
  const extraPages: ResearchPack["extraPages"] = [];
  let docsUrl: string | undefined;

  // 1. Homepage
  if (website) {
    try {
      const doc = await fc.scrape(website, { formats: ["markdown"], onlyMainContent: true, timeout: 30_000 });
      credits += 1;
      homepageSummary = cleanMarkdown(doc.markdown ?? "").slice(0, HOMEPAGE_CHARS);
      homepageUrl = (doc.metadata as { sourceURL?: string; url?: string } | undefined)?.url ?? website;
    } catch (err) {
      await onError(`homepage scrape failed: ${(err as Error).message}`, { website });
    }
  }
  if (!homepageSummary) flags.push("thin_research");

  // 2. Map site and scrape up to 2 useful pages (changelog, blog, docs, latest post)
  if (website && homepageSummary) {
    try {
      const map = await fc.map(website, { limit: 200, includeSubdomains: true });
      credits += 1;
      const picks = pickExtraPages(map.links ?? [], website);
      for (const pick of picks) {
        try {
          const doc = await fc.scrape(pick.url, { formats: ["markdown"], onlyMainContent: true, timeout: 30_000 });
          credits += 1;
          const md = cleanMarkdown(doc.markdown ?? "").slice(0, EXTRA_PAGE_CHARS);
          if (md.length > 200) {
            extraPages.push({ url: pick.url, title: (doc.metadata as { title?: string })?.title ?? pick.title, markdown: md });
          }
          if (/docs|quickstart|getting-started/.test(pick.url)) docsUrl = pick.url;
        } catch (err) {
          await onError(`page scrape failed: ${(err as Error).message}`, { url: pick.url });
        }
      }
      if (!docsUrl) {
        const d = (map.links ?? []).find((l) => /^https?:\/\/docs\.|\/docs\/?$/.test(l.url));
        if (d) docsUrl = d.url;
      }
    } catch (err) {
      await onError(`site map failed: ${(err as Error).message}`, { website });
    }
  }

  // 3. Recent news / launches / funding, last ~120 days
  const recent: ResearchItem[] = [];
  try {
    const res = await fc.search(`"${company}" (launch OR announces OR release OR funding OR raises)`, {
      limit: 5,
      tbs: dateRangeTbs(120),
      sources: ["web"],
      domainTools: false,
    });
    credits += 2;
    for (const r of (res.web ?? []) as { url?: string; title?: string; description?: string }[]) {
      if (!r.url) continue;
      const text = `${r.title ?? ""} ${r.description ?? ""}`;
      // only keep results that actually mention the company
      if (!text.toLowerCase().includes(company.toLowerCase().split(" ")[0])) continue;
      recent.push({ kind: classify(r.title ?? "", r.description ?? ""), title: r.title ?? r.url, url: r.url, snippet: (r.description ?? "").slice(0, 400) });
      if (recent.length === 3) break;
    }
  } catch (err) {
    await onError(`news search failed: ${(err as Error).message}`, { company });
  }

  // 4. Person's X profile
  let personX: ResearchPack["personX"] = null;
  try {
    const found = await findPersonX(fc, p, company);
    credits += found.credits;
    personX = found.candidate;
  } catch (err) {
    await onError(`X search failed: ${(err as Error).message}`, { company });
  }

  // enforce the total budget
  let used = homepageSummary.length;
  for (const page of extraPages) {
    const room = Math.max(0, TOTAL_CHARS - used);
    page.markdown = page.markdown.slice(0, room);
    used += page.markdown.length;
  }

  if (!homepageSummary && recent.length === 0 && extraPages.length === 0 && !flags.includes("thin_research"))
    flags.push("thin_research");

  const urls = [
    ...new Set(
      [homepageUrl, website, ...extraPages.map((e) => e.url), ...recent.map((r) => r.url), docsUrl].filter(
        (u): u is string => !!u,
      ),
    ),
  ];

  return {
    company,
    website,
    homepageUrl,
    homepageSummary,
    extraPages: extraPages.filter((e) => e.markdown.length > 0),
    recent,
    docsUrl,
    companyX: p.companyTwitter || undefined,
    personX,
    categoryReason: p.categoryReason,
    urls,
    flags,
    creditsUsed: credits,
  };
}

/** All text in the pack, used by the validator to allow numbers that really appear in research. */
export function packText(pack: ResearchPack): string {
  return [
    pack.homepageSummary,
    ...pack.extraPages.map((e) => `${e.title}\n${e.markdown}`),
    ...pack.recent.map((r) => `${r.title} ${r.date ?? ""} ${r.snippet}`),
    pack.categoryReason,
  ].join("\n");
}
