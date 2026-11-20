# TensorTonic Outreach

Internal tool for sponsor outreach. Pick prospects in the Google Sheet, click **Research & Draft**, review, then send:

- **Email** goes out through Zoho Mail from one sending mailbox (Aryan's), written as "we at TensorTonic".
- **LinkedIn note and X DM** are written in Pratham's voice. Pratham sends them by hand from the **Ready to send** page (copy, open profile, paste, mark sent).

Google Sheets is the source of truth. The app adds 19 `AI …` columns to each tab it drafts in and writes status back so the whole team sees the same picture.

Setup: see [SETUP.md](SETUP.md). Build spec: [BUILD_SPEC.md](BUILD_SPEC.md).

## Pages

| Page | What it's for |
|---|---|
| `/prospects` | Pick sheet and tab, filter, select rows, pick the campaign, run Research & Draft (shows the credit estimate first, then live progress per row) |
| `/review` | One card per draft: research and sources on the left, editable subject/body/LinkedIn/X with live counts on the right. Approve / Regenerate (with an instruction) / Skip / Reject. Keys: `A` approve, `R` regenerate, `J`/`K` next and previous. Bulk "Approve & queue selected" |
| `/ready` | Pratham's page: every approved person whose LinkedIn note or X DM isn't sent yet |
| `/settings` | Connected sheets and the per-tab mapping report, Zoho connection, dry-run, daily cap and gaps, never-contact list, write-back toggles, prompt and templates with version history, send queue |
| `/activity` | Every run, edit, approval, send and failure. Filter it, export CSV |

## How a row flows

```
Prospects → Research & Draft (Inngest, 3 rows at a time)
  Firecrawl: homepage → site map → up to 2 of changelog/blog/docs → news search (last 120 days) → person's X search
  Claude (structured JSON) → rule checker → one automatic fix-up call if a check fails
  → AI columns written to the sheet: "Drafted" or "Needs review"
Review → Approve → Queue email ─→ send worker (one at a time per mailbox, 30/day, 60–180 s gaps, weekdays)
                                   re-reads the sheet first: cancels if Meeting Booked, email changed, or already emailed from another tab
       → Pratham: copy LinkedIn/X + open profile → Mark sent
```

## Safety rails

- Dry-run is ON by default. Turning it off means typing SEND in Settings, and it's logged. "Send test to me" sends to your own address even in dry-run.
- Only approved drafts can be queued, and a draft with a failing check can't be approved.
- The rule checker runs after every generation and every edit: length limits, dashes, banned words, hiring language, invented numbers, hook URL must come from the research, deck link present, first name in the greeting, no fake "Re:".
- The tool writes only its own `AI …` columns plus `Outreach Status`, `Owner` and `Linkedin` (each can be switched off). Rows are found by email + company right before every write. If a row is missing or duplicated, nothing is written and the error is logged.
- People who appear in several tabs are emailed at most once per 30 days (configurable). LinkedIn and X marks show up across tabs too.
- Companies on the never-contact list (default: Gradium) are never drafted or emailed.
- X profiles are accepted only with evidence (name plus company or role in the profile or search snippet). Handles are never guessed. Low-confidence matches lock the X button until someone confirms the profile.

## Stack

Next.js 16 (App Router) · Auth.js (Google) · Drizzle + Neon Postgres · Inngest · Firecrawl · Anthropic API · Zoho Mail REST · Tailwind. Deployed on Vercel.

## Phase 2 hooks (not built)

- Follow-ups as real replies: `send_queue.zoho_message_id` is stored for every send. Add `ZohoMail.messages.READ`, then a follow-up event that sleeps N days, checks for replies and replies in-thread.
- Reply detection → set Outreach Status to `Replied`.
- Per-company Papermark deck links: swap `deckLink` per row in `generateDraft`.
- Scheduled runs: add a `cron` trigger to a new Inngest function that calls the same `outreach/row.research` event.
