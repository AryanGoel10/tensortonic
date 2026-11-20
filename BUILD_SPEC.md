# TensorTonic Sponsor Outreach Tool: Build Spec for Claude Code

## How to use this file

1. Make a new empty folder (e.g. `tt-outreach`), put this file in it as `BUILD_SPEC.md`, and open Claude Code there.
2. Paste this kickoff prompt:

> Read BUILD_SPEC.md fully. Then build the tool milestone by milestone, starting with M0. Before each milestone, show me a short plan. At the end of each milestone, stop, tell me what to test and which env vars or accounts I need to set up, and wait for my go-ahead. Never send a real email unless I explicitly turn off dry-run mode. When a third-party API detail in this spec conflicts with that provider's current docs, follow the docs and tell me.

3. Connect the Zoho MCP, Firecrawl MCP and Vercel MCP in Claude Code if you have them. They're useful for checking API responses and deploying while building. The app itself calls the APIs directly and doesn't depend on MCP at runtime.

---

## 1. What the tool does (one paragraph)

A small internal web app for the TensorTonic team. A team member signs in, picks a Google Sheet tab of prospects (e.g. "Voice AI" in *TensorTonic Sponsor Targeting*), selects rows, and clicks **Research & Draft**. For each person the app researches their company with Firecrawl and finds the person's X profile. Claude then writes a personalised email, LinkedIn note and X DM pitching a TensorTonic contest built on that company's product. Drafts are written back into the same sheet. The team member reviews, edits and approves each draft in the app. Approved emails are sent through **Zoho Mail from the owner's own mailbox**. LinkedIn and X stay one click per person: copy the message and open the profile, then mark it done. Every step writes status back to the sheet so the whole team sees the same picture.

**Goal:** about 1 minute of human time per prospect across all three channels, with a personal line in every message that's actually true.

---

## 2. Decisions already made (don't change without asking)

| Area | Decision | Why |
|---|---|---|
| App | Next.js (App Router, TypeScript) + Tailwind + shadcn/ui, deployed on Vercel | Team-accessible URL, Aryan already uses Vercel |
| Auth | Auth.js with Google sign-in. Allowlist: any `@tensortonic.com` address **plus** emails in `ALLOWED_EMAILS` env | Aryan signs in with a Gmail address, so a domain check alone would lock him out |
| Prospect data | **Google Sheets is the source of truth.** Read and write through a Google service account that has Editor access to the sheet | Team already lives in the sheet. Any sheet or tab can be added in Settings, so the source is dynamic |
| App database | Postgres (Neon through the Vercel marketplace) + Drizzle ORM | Only for things that shouldn't live in a sheet: users, encrypted Zoho tokens, job runs, send queue, activity log, settings/templates |
| Background jobs | Inngest (free tier) | Research jobs and sends with delays run longer than a Vercel function timeout. Inngest gives retries, `step.sleep`, and concurrency limits |
| Research | Firecrawl API (`@mendable/firecrawl-js`) | Already used on the team |
| Writing | Anthropic API, model from env `CLAUDE_MODEL` (default `claude-sonnet-5-5`), structured JSON output | Cost-effective and good at short copy |
| Email | Zoho Mail REST API, OAuth per user, sending from that user's own mailbox. **No Apollo** | Requested. Owners (Aryan, Shivam, Pratham) send as themselves |
| LinkedIn / X | **No automated sending.** Copy-to-clipboard + open profile, then a "Mark sent" button | Automating LinkedIn breaks its terms and can get accounts restricted. X DM API is paid and most DMs are closed to non-followers |
| Trigger | Manual only (button). No cron in v1 | Requested |

---

## 3. The flow

```
[Sign in with Google]
      |
[Prospects page] -- choose connected sheet -> choose tab -> table of rows
      |  filter (Outreach Status, Owner, Draft Status), select rows
      |  choose campaign type: "First touch" or "Re-engage (already contacted)"
      v
[Research & Draft]  (Inngest job, concurrency 3, per row)
   1. Firecrawl: scrape company homepage (markdown, main content only)
   2. Firecrawl: map site, scrape up to 2 of: /blog, /changelog, /docs index, latest blog post
   3. Firecrawl search: "{Company}" news / launch / funding, last ~120 days, top 5
   4. Firecrawl search: find the person's X profile (see 6.3)
   5. Claude: research summary + hook + challenge idea + email + LinkedIn note + X DM (JSON)
   6. Validator: rule checks (section 7). Fail -> Draft Status "Needs review"
   7. Write results to the sheet row's AI columns. Draft Status "Drafted"
      |
[Review page] -- one card per drafted prospect
   - left: research summary with source links, person X URL (editable)
   - right: editable subject, email body, LinkedIn note, X DM, with live char counts
   - buttons: Approve | Regenerate (optional instruction box) | Reject | Skip
      |
[Approved]
   - "Queue email": goes to the send queue (Zoho, sender = signed-in user)
   - "Copy LinkedIn note + open profile": copies note, opens Person LinkedIn URL in a new tab
       then "Mark LinkedIn sent"
   - "Copy X DM + open X": same for X, then "Mark X sent"
   - "Approve & queue all selected": bulk action
      |
[Send queue worker]  (Inngest)
   - per-mailbox daily cap (default 30), random 60-180s gap between sends
   - dry-run mode (global setting, ON by default): logs what would be sent and doesn't call Zoho
   - after send: write Email Sent At, Zoho Message ID, update Outreach Status (see 5.3)
      |
[Activity page] -- log of runs, sends, failures, who did what
```

---

## 4. Google Sheets integration

### 4.1 Connecting sheets (dynamic source)
- Settings has a **Connected sheets** list. Add one by pasting the sheet URL. The app extracts the ID, checks the service account can open it, and lists the tabs.
- If the service account lacks access, show its email with a "share the sheet with this address as Editor" message.
- The first sheet to connect: `https://docs.google.com/spreadsheets/d/1NApt8DQNuzOTgyZ9U6IVJPokJh0GgD-ed45dwvxRAE0`
- Always read live from the sheet when a page loads or the user clicks Refresh. Don't cache prospect data in Postgres.

### 4.2 Header mapping (tabs aren't consistent)
The current sheet has 10 tabs: Dev Tooling, Inference, Evals, SML, GPU & AI Hardware, Voice AI, AI Security, Model Labs, Retrieval & RAG, Robotics & Physical AI. Their headers differ. Map by header name, case-insensitive, using these aliases:

| Internal field | Accepted headers |
|---|---|
| `outreachStatus` | Outreach Status |
| `owner` | Owner |
| `linkedinStatus` | Linkedin |
| `firstName` | First Name (else first token of Name) |
| `lastName` | Last Name (else rest of Name) |
| `title` | Title |
| `company` | Company Name, Company |
| `email` | Email, To |
| `department` | Departments |
| `personLinkedin` | Person Linkedin Url |
| `website` | Website |
| `companyLinkedin` | Company Linkedin Url |
| `twitter` | Twitter Url |
| `categoryReason` | any header starting with "Why it is" |

- If a tab is missing `email` or `company`, show a warning on that tab and don't allow drafting for it.
- `categoryReason` is valuable context (e.g. "Developers build avatar experiences with its API and JavaScript SDK"). Pass it to Claude.
- Existing `Twitter Url` values are often **company** handles, not the person's. Treat them as company X, never as the person's handle.

### 4.3 Row identity
Rows move when people sort or insert. Never store row numbers. Identify a row by `lowercase(email)` + `company`, and re-locate it by key just before every write. If the key isn't found or matches 2+ rows, don't write. Log it and show an error on the card.

### 4.4 Tool-owned columns
On first draft run in a tab, if missing, append these columns to the right of the existing ones. Ask for confirmation in the UI first. Never write to any other column except those listed in 5.3.

`AI Draft Status`, `AI Campaign`, `AI Research Summary`, `AI Sources`, `AI Hook`, `AI Challenge Idea`, `AI Email Subject`, `AI Email Body`, `AI LinkedIn Note`, `AI X DM`, `AI Person X URL`, `AI X Confidence`, `AI Flags`, `AI Last Run`, `AI Email Sent At`, `AI Email Sent By`, `AI Zoho Message ID`, `AI LinkedIn Sent At`, `AI X Sent At`

Edits made in the Review page write back to these columns immediately (debounced). If someone edits the AI columns directly in the sheet, the app shows the sheet value on next refresh, so the sheet wins.

Use `spreadsheets.values.batchUpdate` and keep writes per row small. Respect Sheets API quotas: retry with backoff on 429.

---

## 5. Statuses

### 5.1 `AI Draft Status` values
`Researching` → `Drafted` | `Needs review` → `Approved` → `Queued` → `Emailed` | `Failed`. Also `Rejected`, `Skipped`.

### 5.2 Which rows are eligible
- Default filter hides rows where Outreach Status = `Meeting Booked` or AI Draft Status = `Emailed`.
- **Campaign type** is chosen per run:
  - `First touch`: rows with empty Outreach Status.
  - `Re-engage`: rows with Outreach Status `Message Done` or `Followed Up`. Uses the re-engage template: a **fresh email with a new subject**, not a reply and no "Re:" prefix.
- Show a count before running ("23 rows, about N Firecrawl credits") and ask for confirmation.

### 5.3 Writes to the team's own columns (configurable in Settings, on by default)
- After a First touch email sends: `Outreach Status` = `Message Done`.
- After a Re-engage email sends: `Outreach Status` = `Followed Up`.
- `Owner`: if empty, set to the sender's display name.
- `Linkedin`: after "Mark LinkedIn sent", set to the sender's display name. *(Check with Aryan what this column currently means before shipping this. Values today are "None" or a name.)*

---

## 6. Research and drafting

### 6.1 Research step (per row)
Collect into a `ResearchPack` JSON: homepage summary, product/API/SDK description, 0-3 recent items (launch, changelog entry, blog post, funding) each with URL and date, docs/quickstart URL if found, company X handle, and person X candidate. Truncate scraped markdown to about 6k tokens total before sending to Claude. If the website fails to scrape, continue with `categoryReason` + search results and add flag `thin_research`.

### 6.2 Generation step
One Claude call with the system prompt in section 8 and the ResearchPack + row fields as input. Require JSON output matching:

```ts
{
  research_summary: string,      // 2-3 plain sentences about what they sell and to whom
  hook: string,                  // 1 sentence, a specific true fact about them
  hook_source_url: string,       // must be one of the URLs in the ResearchPack
  challenge_idea: string,        // 1 sentence: a contest challenge built on their product
  email_subject: string,
  email_body: string,            // plain text, signature placeholder {{SENDER_SIGNATURE}}
  linkedin_note: string,         // <= 280 chars
  x_dm: string,                  // <= 280 chars
  confidence: "high" | "medium" | "low",
  flags: string[]                // e.g. ["thin_research", "unsure_what_product_does"]
}
```

"Regenerate" sends the previous draft plus the reviewer's instruction (e.g. "make the challenge about their MCP server") and returns the same shape.

### 6.3 Finding the person's X profile
- Firecrawl search: `"{firstName} {lastName}" "{company}" site:x.com OR site:twitter.com`, then a fallback without the company name plus their title keywords.
- Accept a candidate only if the handle's page or search snippet mentions the company, their role, or their LinkedIn name. Set `AI X Confidence` to `high`/`medium`/`low`. Leave empty if nothing passes.
- `low` confidence shows a warning on the card and disables "Copy X DM + open X" until the reviewer confirms or edits the URL.
- Never guess a handle from the name pattern.

---

## 7. Validator (runs after every generation and every manual edit)

Hard fails (set `Needs review` and list in `AI Flags`):
- `linkedin_note` > 280 chars, `x_dm` > 280 chars, `email_subject` > 60 chars, `email_body` > 160 words (excluding signature).
- `hook_source_url` not in the ResearchPack URLs.
- Contains an em dash (—) or en dash used as a dash.
- Contains banned words: unlock, supercharge, game-changing, game changer, seamless, revolutionize, leverage, synergy, cutting-edge, excited to, hope this finds you well.
- Contains hiring language: hire, hiring, recruit, recruiting, candidates, talent pipeline, screening.
- Contains any number not in the allowlist: `50,000+`, `1M+`, `1,300+`, `1,000+`, `30`, `20`, and numbers that appear in the ResearchPack. This catches invented stats.
- Missing the deck link in the email body.
- First name not used in the greeting.

Soft warnings (shown on the card, don't block approval): `confidence` = low, `thin_research`, company X used because no person X was found.

---

## 8. Content rules and prompt

Store the system prompt, both email templates, the signature per user and the deck link in **Settings** (Postgres), editable in the UI by any signed-in user, with version history (keep last 10). Seed with the following.

### 8.1 Facts the model may use (from the approved deck, 18 Nov 2026)
- TensorTonic: an ML coding practice platform. Over 50,000 registered engineers write real code on it; 1M+ code submissions run and graded; 1,300+ problems, from ML basics to CUDA kernels, inference and agents.
- Contests: the company brings its product; TensorTonic writes problems that need the product, the company reviews the drafts once, engineers build and get auto-scored against hidden tests, then the company gets a report on where developers got stuck in its docs and SDK.
- Timeline: about 1 week setup, 2 to 4 week contest, report 1 week after.
- What they get: a thousand engineers building with their product, scored results for every submission, a report on where developers got stuck, showcase builds they can share, and top builders who opt in to be contacted.
- Proof: first contest is with Gradium (voice AI), 30 days from 20 Nov 2026. 1,000+ teams signed up before day one. Gradium put in credits and interviews as prizes.
- Problem framing: developers sign up, try the quickstart, and quietly disappear.
- Deck link: `https://drive.google.com/file/d/17o6V9UaNz0ytLw4SDDKMxT8M_OMkM_3F/view?usp=drivesdk`
- CTA: a 20-minute call to figure out the format together.

### 8.2 Hard rules for the model
- TensorTonic is **not** a hiring or recruiting platform. Never position it as one. "Top builders who opt in to be contacted" is the only allowed phrasing near that topic.
- Never invent numbers, customers, partners, testimonials or results. Only use 8.1 facts and facts in the ResearchPack.
- The hook must be about **them** (a launch, SDK, changelog item, something specific on their site), not flattery ("love what you're building").
- The challenge idea must name their actual product or API and describe something a developer would build in 1 to 4 weeks. Example: "Build a voice agent that books meetings using Anam's avatar SDK."
- Plain English, short sentences, no em dashes, no marketing words, no exclamation marks.
- Gradium is a partner. Mention it as proof only. Don't claim things about Gradium beyond 8.1.

### 8.3 First-touch email template (structure; model writes the words)
```
Subject: {Company} x TensorTonic contest   (or a short variant about them)

Hi {firstName},

{hook}  -- 1 sentence, specific to them

We're running a 30-day contest with Gradium right now and 1,000+ teams signed up before day one. I think the same format could work for {Company}.

{challenge_idea}  -- framed as "For {Company}, the challenge could be: ..."

You bring the product, we write the problems, score every submission and send you a report on where developers got stuck in your docs and SDK.

Deck: {deckLink}

Open to a 20-minute call next week?

{{SENDER_SIGNATURE}}
```

### 8.4 Re-engage email template
Same as above, but the opening is one honest line, e.g. "I reached out a few weeks ago about running a contest on TensorTonic. Since then we've launched one with Gradium and 1,000+ teams signed up before day one." Then hook, challenge idea, offer, deck, CTA. New subject, not a reply.

### 8.5 LinkedIn note (≤ 280 chars)
Hook-lite + the contest idea in one line + "would love to connect". No link (links in connection notes look spammy).

### 8.6 X DM (≤ 280 chars)
Casual, one line on their product, one line on the challenge idea, then the deck link.

---

## 9. Zoho Mail integration

- Settings page: **Connect Zoho Mail** button per user (OAuth 2.0 authorization code flow, offline access for a refresh token).
- Region is configurable via env because TensorTonic may be on Zoho India: `ZOHO_ACCOUNTS_BASE` (e.g. `https://accounts.zoho.in` or `https://accounts.zoho.com`) and `ZOHO_MAIL_API_BASE` (e.g. `https://mail.zoho.in` or `https://mail.zoho.com`).
- Scopes: `ZohoMail.accounts.READ`, `ZohoMail.messages.CREATE` (add `ZohoMail.messages.READ` in phase 2 for reply detection).
- After connect: call `GET /api/accounts` to store the user's `accountId` and primary `fromAddress`.
- Send: `POST /api/accounts/{accountId}/messages` with `fromAddress`, `toAddress`, `subject`, `content`, `mailFormat` (`plaintext` preferred for cold email). Store the returned message ID.
- **Verify every endpoint and field name against current Zoho Mail API docs before implementing.** Use the Zoho MCP in Claude Code to test calls.
- Store refresh tokens encrypted (AES-256-GCM, key from `ENCRYPTION_KEY`). Refresh access tokens on 401.
- Deliverability rules: no tracking pixels, no link shorteners, one link (the deck), plain text, per-mailbox cap of 30/day by default, 60-180s random gap, no sending on Sat/Sun unless overridden.
- Test path: dry-run → "Send test to myself" button (sends the draft to the signed-in user's own address) → real sends.
- Before each send, re-read the row from the sheet. If Outreach Status became `Meeting Booked` or the email changed, cancel and log it.

---

## 10. Pages

1. **/login**: Google sign-in.
2. **/prospects**: sheet + tab pickers, table (Name, Title, Company, Owner, Outreach Status, AI Draft Status, flags), filters, select-all, campaign type, **Research & Draft** button, live progress per row.
3. **/review**: card list of `Drafted` / `Needs review` rows for the chosen tab, keyboard shortcuts (`A` approve, `R` regenerate, `J/K` next/prev), char counters, validator results inline, channel buttons for approved rows.
4. **/settings**: connected sheets, Zoho connection, signature, deck link, templates + system prompt editor with version history, caps, dry-run toggle, status write-back toggles.
5. **/activity**: runs, sends, failures, filterable by user and tab, with CSV export.

Keep the UI plain: black/white with TensorTonic green (`#00C875`-ish) as accent, matching the deck.

---

## 11. Environment variables

```
NEXTAUTH_URL, NEXTAUTH_SECRET
GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET          # sign-in
ALLOWED_EMAILS                                   # comma-separated, e.g. goel.aryan26@gmail.com
ALLOWED_DOMAIN=tensortonic.com
GOOGLE_SERVICE_ACCOUNT_JSON                      # base64 of service account key, Sheets scope
DATABASE_URL                                     # Neon
INNGEST_EVENT_KEY, INNGEST_SIGNING_KEY
FIRECRAWL_API_KEY
ANTHROPIC_API_KEY, CLAUDE_MODEL=claude-sonnet-5-5
ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET, ZOHO_ACCOUNTS_BASE, ZOHO_MAIL_API_BASE
ENCRYPTION_KEY                                   # 32-byte base64
```

Write a `SETUP.md` covering exactly how to create each one: Google Cloud project, OAuth client, service account + sharing the sheet, Zoho API console client (with the right region), Neon, Inngest, Vercel env setup.

---

## 12. Milestones (stop and check in after each)

**M0: Scaffold.** Next.js app, Auth.js Google sign-in with allowlist, Drizzle + Neon, Inngest wired, deployed to Vercel preview. Test: Aryan can sign in, a non-allowlisted account can't.

**M1: Sheets read.** Connect sheet, list tabs, header mapping, prospects table with filters, row-key logic, warnings for unmappable tabs. Test on all 10 tabs of *TensorTonic Sponsor Targeting*, and show a per-tab report of mapped columns and row counts.

**M2: Research & Draft.** ResearchPack, X finder, Claude generation, validator, AI column creation and write-back. Settings seeded with section 8 content. **Test on 10 rows of the Voice AI tab, then stop.** Output a table of hook, challenge idea, X URL and flags so Aryan and Pratham can judge quality before going further.

**M3: Review.** Review cards, inline editing with write-back, regenerate with instruction, approve/reject/skip, bulk approve.

**M4: Zoho send.** Per-user OAuth, dry-run, send-to-self, queue worker with caps and gaps, status write-back, pre-send re-check. Test: dry-run of 5, send-to-self of 2, then 3 real sends only after Aryan says go.

**M5: LinkedIn/X helpers + activity.** Copy-and-open buttons, mark-sent write-back, activity log, CSV export, SETUP.md complete.

**Phase 2 (don't build yet, design so it's easy to add):**
- Follow-up step N days later, sent as a real reply in the same Zoho thread using the stored message ID, auto-stopped if the prospect replied (needs `messages.READ`).
- Reply detection that sets Outreach Status to `Replied`.
- Deck open tracking via Papermark links per company.
- Optional scheduled run.

---

## 13. Non-negotiables

- Dry-run is ON by default and only a signed-in user can turn it off, with a confirmation dialog.
- Nothing is sent without a human approving that specific draft.
- Never fake email threads ("Re:" subjects without real reply headers).
- Never write to sheet columns other than the AI columns and the 5.3 columns.
- No secrets in the repo. `.env.example` only.
- Log every external call failure with the row key so nothing fails silently.
- Rough cost to show in the UI before a run: about 3-5 Firecrawl credits and one Claude call per row.
