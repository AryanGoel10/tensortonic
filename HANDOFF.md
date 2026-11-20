# Handoff: TensorTonic Outreach

For Pratham. This is where the tool stands, how it works, and what's left. Read alongside `BUILD_SPEC.md` (the original spec), `README.md` (overview) and `SETUP.md` (accounts and keys).

Live app: https://tensortonic-outreach.vercel.app (Vercel project `tensortonic-outreach`, team "Aryan"). Every push to `main` deploys to production.

## How it works

```
Prospects page → "Research & Draft"
  → server action writes job rows to Postgres, sends one Inngest event per row
  → Inngest calls POST /api/inngest → function research-and-draft-row (src/inngest/functions.ts)
       step load-row   read the row from the sheet by key (email|company), set "Researching"
       step research   Firecrawl: homepage, site map + 2 pages, news search, person's X search (src/lib/research)
       step write      LLM draft as structured JSON (src/lib/ai/generate.ts) + rule checker (src/lib/validator.ts)
       step fix        only if a check failed: one repair call
       step write-back AI columns in the sheet, research pack saved in Postgres
Review page → edit / Regenerate / Approve → "Queue email"
  → Inngest function send-email: one at a time per mailbox, daily cap, 60–180 s gaps, weekdays,
    re-reads the sheet before sending, dry-run unless turned off in Settings
Ready to send page → Pratham copies LinkedIn / X messages, opens profile, "Mark sent"
```

Key files:

| Area | File |
|---|---|
| Sheet read/write, header mapping, row keys | `src/lib/sheets/mapping.ts`, `src/lib/sheets/client.ts` |
| Research | `src/lib/research/firecrawl.ts`, `src/lib/research/xfinder.ts` |
| Writing (provider switch) | `src/lib/ai/generate.ts`, `src/lib/ai/gemini.ts` |
| Prompt, templates, deck facts, default settings | `src/lib/settings-defaults.ts` (editable in the app under Settings → Content; values saved there override these defaults) |
| Rule checker | `src/lib/validator.ts` |
| Background jobs | `src/inngest/client.ts`, `src/inngest/functions.ts` |
| Zoho send + OAuth | `src/lib/zoho.ts`, `src/app/api/zoho/*` |
| Login (username + password) | `src/auth.ts`, `src/lib/passwords.ts`, Settings → Team |
| Cross-tab duplicate guard | `src/lib/history.ts` |
| DB schema + migrations | `src/db/schema.ts`, `drizzle/` (applied automatically on every Vercel build by `scripts/migrate.ts`) |

## Which LLM writes the drafts

`provider()` in `src/lib/ai/generate.ts`: **`ANTHROPIC_API_KEY` set → Claude** (`CLAUDE_MODEL`, default `claude-sonnet-5-5`), else **`GEMINI_API_KEY` → Gemini free tier**, else Vercel AI Gateway. After adding or changing a key in Vercel, redeploy (Deployments → ⋯ → Redeploy).

## Environment (all set in Vercel)

Set and working: DB (Neon integration), Inngest (`TT_INNGEST_EVENT_KEY` / `TT_INNGEST_SIGNING_KEY` from the TensorTonic Inngest account override the integration's `INNGEST_*`, which pointed at a different Inngest account), `NEXTAUTH_*`, `ENCRYPTION_KEY` (never change it: stored Zoho tokens depend on it), `BOOTSTRAP_USERS`, Google service account, Firecrawl, Zoho client + India URLs, `GEMINI_API_KEY`.

Not set yet: `ANTHROPIC_API_KEY`.

Leftovers that do nothing now (safe to delete in Vercel): `ALLOWED_DOMAIN`, `ALLOWED_EMAILS` (from the old Google sign-in).

Connected in the app: sheet "TensorTonic Sponsor Targeting" (AI columns already added to the Voice AI tab), Zoho mailbox goel.aryan26@tensortonic.com (sending mailbox). Dry-run is ON.

## Status

Done and verified on production: login, Team management, sheet connect, Zoho connect, Inngest sync, the research step.

Not yet verified end to end: the writing step. Google retired `gemini-2.5-flash`; the code now tries `gemini-3.8-flash`, `3.7`, `3.6`, `3.5-flash-lite`, `3.1-flash-lite`, `3-flash` in order and shows every model's error on the row if none works. If Gemini's free tier doesn't allow any of them, add `ANTHROPIC_API_KEY` and redeploy.

Then, in order: 1 row → 10 Voice AI rows (judge quality) → dry-run queue of 5 → "Send test to me" → real sends after Aryan says go.

## Open decisions (from Aryan's email sequence doc)

Doc: https://docs.google.com/document/d/1YcLuJCy8IVX0ZyOcpaL5VzKbWCzEF0Rolaqb7M0rdyo

1. Use the doc's Email 1 as the template: re-engage version ("I wrote to you in October…") for rows with Outreach Status Message Done / Followed Up, a first-touch version without that line for the rest. Templates live in `settings-defaults.ts` and Settings → Content.
2. Engineer count: doc says 52,000, deck facts say "over 50,000". The rule checker only allows numbers listed in `ALLOWED_NUMBERS` in `src/lib/validator.ts` plus numbers found in the research, so update both the facts and that list.
3. Gradium sign-ups: "[X] teams registered" — currently "1,000+ teams before day one".
4. CTA: doc uses "Would it help if I sent a draft problem set? If the timing's wrong, a quick no is fine too." instead of the 20-minute call.
5. Signature: "Aryan Goel / Founder's Office, TensorTonic" (Settings → Content).
6. Email 2 (day-4 bump) as a real in-thread reply: possible because every send stores `send_queue.zoho_message_id`. Would need a new Inngest step that sleeps 4 days, checks for replies (`ZohoMail.messages.READ` scope), and replies in-thread; still human-approved. Emails 3 and 4 need real contest numbers and Gradium's OK, so add them only when those exist.

## Gotchas

- This is Next.js 16: read `node_modules/next/dist/docs/` before changing framework code (see `AGENTS.md`). Middleware is now `proxy.ts`; this app doesn't use it and checks auth in layouts and server actions instead.
- Vercel stops a request at 5 minutes. Keep each Inngest `step.run` short; hand rate limits back to Inngest with `RetryAfterError` instead of sleeping.
- Vercel Hobby keeps runtime logs for 1 hour. Every step failure is also written to the Activity page (Postgres), which is the long-term record.
- Rows are identified by `lowercase(email)|company`. Don't rename sheet headers.
- Never commit secrets. `.env.local` is gitignored; `.env.example` lists every variable.

## Local development

```bash
cp .env.example .env.local   # fill in (or: npx vercel env pull .env.local)
npm install
npm run dev                  # http://localhost:3000
npm run inngest:dev          # second terminal, local Inngest dashboard at :8288
npm test                     # unit tests
npm run typecheck && npm run lint
```

Draft preview without touching the sheet: `npx tsx scripts/preview-drafts.ts "Voice AI" 10`.
