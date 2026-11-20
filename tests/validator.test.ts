import { describe, expect, it } from "vitest";
import { validate, extractNumbers, bodyWordCount, dashProblems } from "@/lib/validator";

const DECK = "https://drive.google.com/file/d/17o6V9UaNz0ytLw4SDDKMxT8M_OMkM_3F/view?usp=drivesdk";
const ctx = { deckLink: DECK, packUrls: ["https://cartesia.ai", "https://cartesia.ai/blog/sonic-3"], packText: "Sonic 3 launched. 40ms latency. 15 languages.", personXFound: true };
const good = {
  firstName: "Timothy",
  email_subject: "Cartesia x TensorTonic contest",
  email_body: `Hi Timothy,\n\nYou shipped Sonic 3 with 40ms latency.\n\nWe're running a 30-day contest with Gradium right now and 1,000+ teams signed up before day one.\n\nFor Cartesia, the challenge could be: build a real-time voice agent on Sonic in 2 to 4 weeks.\n\nDeck: ${DECK}\n\nOpen to a 20-minute call next week?\n\n{{SENDER_SIGNATURE}}`,
  linkedin_note: "Hi Timothy, I'm Pratham from TensorTonic. Saw Sonic 3. We're running coding contests on dev products, and a voice agent challenge on Sonic could be fun. Would love to connect.",
  x_dm: `Hey Timothy, Pratham here. Sonic 3 is fast. Thinking a TensorTonic contest where devs build voice agents on Sonic. Deck: ${DECK}`,
  hook: "You shipped Sonic 3.",
  challenge_idea: "Build a real-time voice agent on Sonic.",
  hook_source_url: "https://cartesia.ai/blog/sonic-3/",
  confidence: "high",
};

describe("validator", () => {
  it("passes a clean draft", () => {
    const r = validate(good, ctx);
    expect(r.hard).toEqual([]);
    expect(r.ok).toBe(true);
  });
  it("catches length limits", () => {
    const r = validate({ ...good, linkedin_note: "x".repeat(281), email_subject: "y".repeat(61) }, ctx);
    expect(r.hard.some((h) => h.startsWith("linkedin_too_long"))).toBe(true);
    expect(r.hard.some((h) => h.startsWith("subject_too_long"))).toBe(true);
  });
  it("catches em dashes but allows digit ranges with en dash", () => {
    expect(dashProblems("great — really")).toBe(true);
    expect(dashProblems("wow – nice")).toBe(true);
    expect(dashProblems("2–4 weeks")).toBe(false);
  });
  it("catches banned and hiring words", () => {
    const r = validate({ ...good, x_dm: good.x_dm + " seamless. Great for hiring." }, ctx);
    expect(r.hard.some((h) => h.includes("banned_words") && h.includes("seamless"))).toBe(true);
    expect(r.hard.some((h) => h.includes("hiring_language"))).toBe(true);
  });
  it("does not flag 'hire' inside other words", () => {
    const r = validate({ ...good, x_dm: good.x_dm.replace("fast", "Cheshire fast") }, ctx);
    expect(r.hard.some((h) => h.includes("hiring"))).toBe(false);
  });
  it("catches invented numbers but allows deck and research numbers", () => {
    const r = validate({ ...good, email_body: good.email_body.replace("40ms", "40ms and 3x faster for 500 teams") }, ctx);
    expect(r.hard.find((h) => h.startsWith("unverified_numbers"))).toMatch(/500/);
    expect(validate(good, ctx).hard.find((h) => h.startsWith("unverified_numbers"))).toBeUndefined();
  });
  it("hook source must be in the research pack", () => {
    expect(validate({ ...good, hook_source_url: "https://example.com" }, ctx).hard).toContain("hook_source_not_in_research");
  });
  it("needs deck link, first-name greeting, no links in LinkedIn, no fake Re:", () => {
    const r = validate({ ...good, email_body: good.email_body.replace(DECK, "").replace("Hi Timothy", "Hi there"), linkedin_note: "see https://x.com", email_subject: "Re: contest" }, ctx);
    expect(r.hard).toEqual(expect.arrayContaining(["missing_deck_link", "first_name_not_in_greeting", "link_in_linkedin_note", "fake_reply_subject"]));
  });
  it("soft warnings", () => {
    const r = validate({ ...good, confidence: "low", modelFlags: ["thin_research"] }, { ...ctx, personXFound: false });
    expect(r.ok).toBe(true);
    expect(r.soft).toEqual(expect.arrayContaining(["low_confidence", "thin_research", "no_person_x_found"]));
  });
  it("number extraction ignores URLs and keeps suffixes", () => {
    expect(extractNumbers(`1,000+ teams, 1M+ runs, 2 builders ${DECK}`)).toEqual(["1,000+", "1M+", "2"]);
  });
  it("word count excludes signature and URLs", () => {
    expect(bodyWordCount(`one two ${DECK}\n{{SENDER_SIGNATURE}}\nAryan TensorTonic`)).toBe(2);
  });
});
