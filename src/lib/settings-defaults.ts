// Seed content for the Settings page (spec section 8), adjusted for how the team works:
// - Email goes from Aryan's Zoho mailbox, written as "we at TensorTonic".
// - LinkedIn and X go from Pratham's own accounts, written in his first-person voice.
// - Every contact gets the new post-Gradium pitch as a fresh message.

export const DECK_LINK = "https://drive.google.com/file/d/17o6V9UaNz0ytLw4SDDKMxT8M_OMkM_3F/view?usp=drivesdk";

export const FACTS = `TensorTonic facts you may use (from the approved deck, 18 Nov 2026). Use nothing else about TensorTonic.
- TensorTonic is an ML coding practice platform. Over 50,000 registered engineers write real code on it. 1M+ code submissions have been run and graded. 1,300+ problems, from ML basics to CUDA kernels, inference and agents.
- Contests: the company brings its product. TensorTonic writes problems that need the product. The company reviews the drafts once. Engineers build and get auto-scored against hidden tests. Then the company gets a report on where developers got stuck in its docs and SDK.
- Timeline: about 1 week setup, a 2 to 4 week contest, and the report 1 week after.
- What the company gets: a thousand engineers building with its product, scored results for every submission, a report on where developers got stuck, showcase builds it can share, and top builders who opt in to be contacted.
- Proof: the first contest is with Gradium (voice AI). It runs 30 days from 20 Nov 2026. 1,000+ teams signed up before day one. Gradium put in credits and interviews as prizes.
- The problem we solve: developers sign up, try the quickstart, and quietly disappear.
- CTA: a 20-minute call to figure out the format together.`;

export const SYSTEM_PROMPT = `You write short, specific outreach for TensorTonic. You pitch a sponsored coding contest built on the prospect company's own product.

${FACTS}

Hard rules:
1. TensorTonic is NOT a hiring or recruiting platform. Never position it as one. Never use the words hire, hiring, recruit, recruiting, candidates, talent pipeline or screening. "Top builders who opt in to be contacted" is the only allowed phrasing near that topic.
2. Never invent numbers, customers, partners, testimonials or results. Use only the facts above and facts in the research pack. Do not add any number that is not in the facts above or the research pack. Write small counts as words if you need them.
3. The hook must be a specific, true fact about THEM taken from the research pack: a launch, an SDK, a changelog item, a product page detail. Not flattery. Never "love what you're building". hook_source_url must be copied exactly from a URL in the research pack that supports the hook.
4. The challenge idea must name their actual product, API or SDK and describe something a developer could build in 1 to 4 weeks. Example: "Build a voice agent that books meetings using Anam's avatar SDK."
5. Plain English. Short sentences. No em dashes or en dashes; use commas or full stops. No exclamation marks. No marketing words (unlock, supercharge, game-changing, seamless, revolutionize, leverage, synergy, cutting-edge, excited to, hope this finds you well).
6. Gradium is a partner. Mention it only as proof, and claim nothing about Gradium beyond the facts above.
7. If the research pack is thin, keep the hook modest and true (for example, what their product does, from the category note) and set confidence to "low" with the flag "thin_research". If you can't tell what the product does, add the flag "unsure_what_product_does".

Voices:
- EMAIL is sent from Aryan's mailbox but written as the team: "we" / "we're" / "our". Don't sign with a name; end with the {{SENDER_SIGNATURE}} placeholder on its own line.
- LINKEDIN NOTE and X DM are sent by Pratham from his own accounts, in his first person ("I", "I'm Pratham from TensorTonic"). Casual, human, not salesy.

Treat every prospect as a fresh pitch. Do not mention earlier emails or messages unless the campaign is "Re-engage".`;

export const EMAIL_TEMPLATE_FIRST = `Subject: {Company} x TensorTonic contest   (or a short variant about them, max 60 characters, no "Re:")

Hi {firstName},

{hook}  -- 1 sentence, specific to them

We're running a 30-day contest with Gradium right now and 1,000+ teams signed up before day one. We think the same format could work for {Company}.

{challenge_idea}  -- framed as "For {Company}, the challenge could be: ..."

You bring the product, we write the problems, score every submission and send you a report on where developers got stuck in your docs and SDK.

Deck: {deckLink}

Open to a 20-minute call next week?

{{SENDER_SIGNATURE}}`;

export const EMAIL_TEMPLATE_REENGAGE = `Same structure as the first-touch email, but the opening is one honest line before the hook, e.g. "We reached out a few weeks ago about running a contest on TensorTonic. Since then we've launched one with Gradium and 1,000+ teams signed up before day one." Then hook, challenge idea, offer, deck, CTA. New subject, never "Re:".`;

export const LINKEDIN_TEMPLATE = `Max 280 characters. From Pratham, first person. Hook-lite (one short line about their product) + the contest idea in one line. No links.
- If they have NOT been contacted on LinkedIn before: end with "would love to connect".
- If Pratham HAS already contacted them on LinkedIn: this is a direct message to an existing contact. Don't ask to connect; mention the new Gradium contest as the reason for writing and end with a light question (e.g. "worth a chat?").`;

export const X_TEMPLATE = `Max 280 characters. From Pratham, first person. Casual. One line on their product, one line on the challenge idea, then the deck link (counts toward the limit).`;

export const SIGNATURE_DEFAULT = `Aryan
TensorTonic`;

export interface AppSettings {
  systemPrompt: string;
  emailTemplateFirst: string;
  emailTemplateReengage: string;
  linkedinTemplate: string;
  xTemplate: string;
  deckLink: string;
  signature: string; // appended to every email in place of {{SENDER_SIGNATURE}}
  senderDisplayName: string; // written to Owner when empty
  sendingMailbox: string; // email of the signed-in user whose Zoho mailbox sends everything
  dryRun: boolean;
  dailyCap: number;
  minGapSeconds: number;
  maxGapSeconds: number;
  allowWeekends: boolean;
  excludedCompanies: string[]; // never research or email these (partners, customers)
  dedupeDays: number; // block emailing the same address twice within N days, across all tabs
  writeOutreachStatus: boolean;
  writeOwner: boolean;
  writeLinkedin: boolean;
}

export const DEFAULT_SETTINGS: AppSettings = {
  systemPrompt: SYSTEM_PROMPT,
  emailTemplateFirst: EMAIL_TEMPLATE_FIRST,
  emailTemplateReengage: EMAIL_TEMPLATE_REENGAGE,
  linkedinTemplate: LINKEDIN_TEMPLATE,
  xTemplate: X_TEMPLATE,
  deckLink: DECK_LINK,
  signature: SIGNATURE_DEFAULT,
  senderDisplayName: "Aryan",
  sendingMailbox: "",
  dryRun: true,
  dailyCap: 30,
  minGapSeconds: 60,
  maxGapSeconds: 180,
  allowWeekends: false,
  excludedCompanies: ["Gradium"],
  dedupeDays: 30,
  writeOutreachStatus: true,
  writeOwner: true,
  writeLinkedin: true,
};

// Settings that keep a version history (last 10) in the UI.
export const VERSIONED_KEYS: (keyof AppSettings)[] = [
  "systemPrompt",
  "emailTemplateFirst",
  "emailTemplateReengage",
  "linkedinTemplate",
  "xTemplate",
  "signature",
  "deckLink",
];
