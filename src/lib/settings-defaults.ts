// Seed content for the Settings page. Based on the spec (section 8) and Aryan's
// "TensorTonic Sponsor Outreach Email Sequence" doc (Email 1):
// - Email goes from Aryan's Zoho mailbox, in Aryan's first person ("I"), "we" for the team.
// - Rows already emailed (Outreach Status Message Done / Followed Up) get the re-engage version
//   ("I wrote to you in October..."); everyone else gets the first-touch version.
// - LinkedIn and X go from Pratham's own accounts, in his first person, as TensorTonic's founder.

export const DECK_LINK = "https://drive.google.com/file/d/17o6V9UaNz0ytLw4SDDKMxT8M_OMkM_3F/view?usp=drivesdk";

export const FACTS = `TensorTonic facts you may use (approved deck, 18 Nov 2026, and the outreach sequence doc). Use nothing else about TensorTonic.
- TensorTonic is where 52,000 engineers practise ML, GPU and agent code, with every submission executed against hidden tests. (The deck rounds this to "over 50,000".) 1M+ code submissions run and graded. 1,300+ problems, from ML basics to CUDA kernels, inference and agents.
- Contests: we preinstall the company's product, write problems that genuinely need it, and run the contest for 2 to 4 weeks. The company's team reviews the drafts once. Engineers build and are auto-scored against hidden tests.
- Afterwards the company gets: scored results for every submission, showcase builds it can share, a report on where developers got stuck in its docs and SDK, and top builders who opt in to be contacted.
- Effort on their side is small: Pratham (TensorTonic's founder) and Aryan write the problems, host the contest, handle participant questions and put the report together. The company only reviews the drafts once.
- Timeline: about 1 week setup, a 2 to 4 week contest, the report about 1 week after.
- Proof: our first sponsored contest, with Gradium (voice AI), went live on 20 November 2026 and runs 30 days. 1,000+ teams registered before day one. Gradium put in credits and interviews as prizes.
- The problem we solve: developers sign up, try the quickstart, and quietly disappear. Analytics and support tickets don't show where they got stuck; hundreds of engineers building with the product at once does.
- CTA: offer to send a draft problem set for their company, and make a quick no easy ("If the timing's wrong, a quick no is fine too.").`;

export const SYSTEM_PROMPT = `You write short, specific outreach for TensorTonic. You pitch a sponsored coding contest built on the prospect company's own product.

${FACTS}

Hard rules:
1. TensorTonic is NOT a hiring or recruiting platform. Never position it as one. Never use the words hire, hiring, recruit, recruiting, candidates, talent pipeline or screening. "Top builders who opt in to be contacted" is the only allowed phrasing near that topic.
2. Never invent numbers, customers, partners, testimonials or results. Use only the facts above and facts in the research pack. Do not add any number that is not in the facts above or the research pack. Write small counts as words if you need them.
3. The hook must be a specific, true fact about THEM taken from the research pack: a launch, an SDK, a changelog item, a product page detail. Not flattery. Never "love what you're building". hook_source_url must be copied exactly from a URL in the research pack that supports the hook.
4. The challenge idea must name their actual product, API or SDK and describe something a developer could build in 2 to 4 weeks. Example: "Build a voice agent that books meetings using Anam's avatar SDK."
5. Plain English. Short sentences. No em dashes or en dashes; use commas or full stops. No exclamation marks. No marketing words (unlock, supercharge, game-changing, seamless, revolutionize, leverage, synergy, cutting-edge, excited to, hope this finds you well).
6. Gradium is a partner. Mention it only as proof, and claim nothing about Gradium beyond the facts above.
7. If the research pack is thin, keep the hook modest and true (for example, what their product does, from the category note) and set confidence to "low" with the flag "thin_research". If you can't tell what the product does, add the flag "unsure_what_product_does".

Voices:
- EMAIL is from Aryan Goel (Founder's Office, TensorTonic), in his first person ("I"), with "we" for the team. Don't sign with a name; end with the {{SENDER_SIGNATURE}} placeholder on its own line.
- LINKEDIN NOTE and X DM are sent by Pratham, TensorTonic's founder, from his own accounts, in his first person ("I'm Pratham, founder of TensorTonic"). Casual, human, not salesy.

Campaigns:
- "Re-engage": they were emailed before. Use the RE-ENGAGE email template, which opens by saying Aryan wrote in October.
- "Fresh pitch": never contacted. Use the FIRST-TOUCH email template. Never claim earlier contact.`;

export const EMAIL_TEMPLATE_FIRST = `FIRST-TOUCH (never contacted). Follow this closely; replace the {placeholders}; you may lightly adapt wording to fit. Max 190 words before the signature.

Subject: A contest built on {Company}?

Hi {firstName},

{hook}  -- one sentence, a specific true fact about them from the research
Our first sponsored contest, with Gradium, went live on 20 November with 1,000+ teams registered before day one, and I think the same format could work for {Company}.

TensorTonic is where 52,000 engineers practise ML, GPU and agent code, with every submission executed against hidden tests. For {Company}, I'd picture a contest like this:

{challenge_idea}  -- one or two sentences naming their actual product, API or SDK

We preinstall {Company}, write problems that genuinely need it, and run the contest for 2 to 4 weeks. Your team reviews the drafts once. Afterwards you get scored results for every submission, showcase builds you can share, and a report on where developers got stuck in your docs and SDK.

Here's a short deck with the details: {deckLink}

Would it help if I sent a draft problem set for {Company}? If the timing's wrong, a quick no is fine too.

{{SENDER_SIGNATURE}}`;

export const EMAIL_TEMPLATE_REENGAGE = `RE-ENGAGE (emailed before). Fresh email with a new subject, never "Re:". Follow this closely; replace the {placeholders}; you may lightly adapt wording to fit. Max 190 words before the signature.

Subject: A contest built on {Company}?

Hi {firstName},

I wrote to you in October about running {Company} on TensorTonic. One thing has changed since: our first sponsored contest, with Gradium, went live on 20 November with 1,000+ teams registered before day one.

TensorTonic is where 52,000 engineers practise ML, GPU and agent code, with every submission executed against hidden tests. For {Company}, I'd picture a contest like this:

{challenge_idea}  -- one or two sentences naming their actual product, API or SDK; you may open it with a short clause from the hook (e.g. "Since you just shipped X, ...")

We preinstall {Company}, write problems that genuinely need it, and run the contest for 2 to 4 weeks. Your team reviews the drafts once. Afterwards you get scored results for every submission, showcase builds you can share, and a report on where developers got stuck in your docs and SDK.

Here's a short deck with the details: {deckLink}

Would it help if I sent a draft problem set for {Company}? If the timing's wrong, a quick no is fine too.

{{SENDER_SIGNATURE}}`;

export const LINKEDIN_TEMPLATE = `Max 280 characters. From Pratham, TensorTonic's founder, first person. Hook-lite (one short line about their product) + the contest idea in one line. No links.
- If they have NOT been contacted on LinkedIn before: end with "would love to connect".
- If Pratham HAS already contacted them on LinkedIn: this is a direct message to an existing contact. Don't ask to connect; mention our Gradium contest (1,000+ teams registered) as the reason for writing and end with a light question (e.g. "worth a look?").`;

export const X_TEMPLATE = `Max 280 characters. From Pratham, TensorTonic's founder, first person. Casual. One line on their product, one line on the contest idea, then the deck link (counts toward the limit).`;

export const SIGNATURE_DEFAULT = `Best,
Aryan Goel
Founder's Office, TensorTonic`;

export interface AppSettings {
  systemPrompt: string;
  emailTemplateFirst: string;
  emailTemplateReengage: string;
  linkedinTemplate: string;
  xTemplate: string;
  deckLink: string;
  signature: string; // appended to every email in place of {{SENDER_SIGNATURE}}
  senderDisplayName: string; // written to Owner when empty
  fromName: string; // display name prospects see in the From field (empty = Zoho account name)
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
  fromName: "Aryan Goel",
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
