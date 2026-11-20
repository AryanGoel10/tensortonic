import { describe, expect, it, beforeAll } from "vitest";
import { scoreHit, handleFromUrl } from "@/lib/research/xfinder";
import { hashPassword, verifyPassword, usernameProblem } from "@/lib/passwords";
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

describe("passwords", () => {
  it("hashes and verifies", async () => {
    const h = await hashPassword("correct horse battery");
    expect(h.startsWith("scrypt$")).toBe(true);
    expect(await verifyPassword("correct horse battery", h)).toBe(true);
    expect(await verifyPassword("wrong", h)).toBe(false);
    expect(await verifyPassword("x", null)).toBe(false);
    expect(await verifyPassword("x", "garbage")).toBe(false);
  });
  it("validates usernames", () => {
    expect(usernameProblem("aryan")).toBeNull();
    expect(usernameProblem("a b")).not.toBeNull();
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

describe("model ids", () => {
  it("maps between Anthropic and AI Gateway ids", async () => {
    const { model } = await import("@/lib/ai/generate");
    const save = { ...process.env };
    delete process.env.ANTHROPIC_API_KEY;
    process.env.CLAUDE_MODEL = "claude-sonnet-5-5";
    expect(model()).toBe("anthropic/claude-sonnet-5.5");
    process.env.CLAUDE_MODEL = "claude-haiku-5-5";
    expect(model()).toBe("anthropic/claude-haiku-5.5");
    process.env.ANTHROPIC_API_KEY = "x";
    expect(model()).toBe("claude-haiku-5-5");
    process.env.CLAUDE_MODEL = "anthropic/claude-sonnet-5.5";
    expect(model()).toBe("claude-sonnet-5-5");
    process.env = save;
  });
});

describe("auto campaign", () => {
  it("re-engages people already emailed, first-touches the rest", async () => {
    const { resolveCampaign } = await import("@/lib/eligibility");
    const p = (s: string) => ({ outreachStatus: s }) as never;
    expect(resolveCampaign(p("Message Done"), "Auto")).toBe("Re-engage");
    expect(resolveCampaign(p("Followed Up"), "Auto")).toBe("Re-engage");
    expect(resolveCampaign(p(""), "Auto")).toBe("Fresh pitch");
    expect(resolveCampaign(p("Message Done"), "Fresh pitch")).toBe("Fresh pitch");
  });
});
