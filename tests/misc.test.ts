import { describe, expect, it, beforeAll } from "vitest";
import { scoreHit, handleFromUrl } from "@/lib/research/xfinder";
import { isAllowed } from "@/lib/allowlist";
import { isWeekend, nextMorning, startOfLocalDay } from "@/lib/time";
import { cleanMarkdown, cleanCompanyName } from "@/lib/research/firecrawl";
import { tidy } from "@/lib/ai/generate";
import { encrypt, decrypt } from "@/lib/crypto";
import { eligible } from "@/lib/eligibility";

const p = { firstName: "Timothy", lastName: "Luong", title: "Head of Enterprise Engineering" };

describe("X finder", () => {
  it("extracts handles and ignores reserved paths", () => {
    expect(handleFromUrl("https://x.com/timluong/status/123")).toBe("timluong");
    expect(handleFromUrl("https://twitter.com/search?q=x")).toBeNull();
    expect(handleFromUrl("https://x.com/i/web/status/1")).toBeNull();
  });
  it("scores by evidence and never guesses", () => {
    expect(scoreHit({ url: "https://x.com/timluong", title: "Timothy Luong (@timluong) / X", description: "Engineering at Cartesia" }, p, "Cartesia")?.confidence).toBe("high");
    expect(scoreHit({ url: "https://x.com/tl", title: "Timothy Luong", description: "engineering lead" }, p, "Cartesia")?.confidence).toBe("medium");
    expect(scoreHit({ url: "https://x.com/tl2", title: "Timothy Luong", description: "dad, runner" }, p, "Cartesia")?.confidence).toBe("low");
    expect(scoreHit({ url: "https://x.com/someone", title: "Tim L", description: "Cartesia" }, p, "Cartesia")).toBeNull();
    expect(scoreHit({ url: "https://x.com/cartesia", title: "Timothy Luong at Cartesia" }, p, "Cartesia", "cartesia")).toBeNull();
  });
});

describe("allowlist", () => {
  const env = { ALLOWED_DOMAIN: "tensortonic.com", ALLOWED_EMAILS: "Someone@gmail.com, other@x.com" };
  it("allows the domain and listed emails only", () => {
    expect(isAllowed("pratham@tensortonic.com", env)).toBe(true);
    expect(isAllowed("someone@gmail.com", env)).toBe(true);
    expect(isAllowed("random@gmail.com", env)).toBe(false);
    expect(isAllowed("x@nottensortonic.com", env)).toBe(false);
    expect(isAllowed("x@tensortonic.com.evil.io", env)).toBe(false);
    expect(isAllowed(null, env)).toBe(false);
  });
});

describe("time (Asia/Kolkata)", () => {
  it("weekends and mornings", () => {
    const sat = new Date("2026-11-21T06:00:00Z"); // Sat 11:30 IST
    expect(isWeekend(sat, "Asia/Kolkata")).toBe(true);
    expect(nextMorning(sat, true, 9, 30, "Asia/Kolkata").toISOString()).toBe("2026-11-23T04:00:00.000Z"); // Mon 09:30 IST
    expect(startOfLocalDay(new Date("2026-11-20T20:00:00Z"), "Asia/Kolkata").toISOString()).toBe("2026-11-20T18:30:00.000Z");
  });
});

describe("helpers", () => {
  it("cleans markdown and company names", () => {
    expect(cleanMarkdown("![logo](x.png)\n[Docs](https://a.com/docs) are here\nSkip to content")).toBe("Docs are here");
    expect(cleanCompanyName("AgentMail (YC S25)")).toBe("AgentMail");
  });
  it("tidy replaces dashes and strips Re:", () => {
    const d = tidy({ research_summary: "", hook: "Fast — really", hook_source_url: "", challenge_idea: "", email_subject: "Re: hi", email_body: "a – b, 2–4", linkedin_note: "", x_dm: "", confidence: "high", flags: [] });
    expect(d.hook).toBe("Fast, really");
    expect(d.email_subject).toBe("hi");
    expect(d.email_body).toBe("a, b, 2–4");
  });
  it("eligibility: fresh pitch is everyone but Meeting Booked", () => {
    const base = { email: "a@b.c", company: "B" } as never as Parameters<typeof eligible>[0];
    expect(eligible({ ...base, outreachStatus: "Followed Up" }, "Fresh pitch")).toBe(true);
    expect(eligible({ ...base, outreachStatus: "Meeting Booked" }, "Fresh pitch")).toBe(false);
    expect(eligible({ ...base, outreachStatus: "" }, "Re-engage")).toBe(false);
    expect(eligible({ ...base, outreachStatus: "Message Done" }, "Re-engage")).toBe(true);
  });
});

describe("crypto", () => {
  beforeAll(() => {
    process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
  });
  it("round-trips and detects tampering", () => {
    const c = encrypt("refresh-token-123");
    expect(decrypt(c)).toBe("refresh-token-123");
    const [iv, tag, ct] = c.split(".");
    expect(() => decrypt([iv, tag, Buffer.from("zzz").toString("base64") + ct].join("."))).toThrow();
  });
});
