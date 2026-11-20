# Setup

About 45 minutes end to end. Do the steps in order; each one gives you values for `.env.local` (local) and Vercel → Project → Settings → Environment Variables (production). `.env.example` lists every variable.

## 1. Google Cloud project

1. Go to <https://console.cloud.google.com/> → project picker → **New project** → name it `tt-outreach`.
2. **APIs & Services → Library** → enable **Google Sheets API**.

### 1a. OAuth client (team sign-in)

1. **APIs & Services → OAuth consent screen** (Google Auth Platform → Branding/Audience).
   - User type: **External** (so allowlisted Gmail addresses can sign in too). App name `TensorTonic Outreach`, support email, your domain.
   - Scopes: the defaults (`openid`, `email`, `profile`) are enough.
   - Audience: while in *Testing*, add every person who will sign in as a **test user** (e.g. Aryan's Gmail, pratham@tensortonic.com). Or click **Publish app**; with only basic scopes there's no Google review.
2. **Credentials → Create credentials → OAuth client ID → Web application**.
   - Authorized JavaScript origins: `http://localhost:3000` and `https://<your-vercel-domain>`
   - Authorized redirect URIs:
     - `http://localhost:3000/api/auth/callback/google`
     - `https://<your-vercel-domain>/api/auth/callback/google`
3. Copy **Client ID** → `GOOGLE_CLIENT_ID`, **Client secret** → `GOOGLE_CLIENT_SECRET`.

The app checks every sign-in itself: `ALLOWED_DOMAIN=tensortonic.com` lets in anyone with a TensorTonic Google account, and `ALLOWED_EMAILS` adds individual addresses (comma-separated). Everyone else is refused, even if Google lets them through.

### 1b. Service account (reads and writes the sheet)

1. **IAM & Admin → Service accounts → Create service account** → name `tt-outreach-sheets`. No roles needed.
2. Open it → **Keys → Add key → Create new key → JSON**. A file downloads.
3. Base64 it on one line and put it in `GOOGLE_SERVICE_ACCOUNT_JSON`:
   - macOS: `base64 -i key.json | tr -d '\n'`
   - Linux: `base64 -w0 key.json`
4. Copy the service account's email (`tt-outreach-sheets@<project>.iam.gserviceaccount.com`).
5. Open **TensorTonic Sponsor Targeting** → **Share** → paste that email → **Editor** → uncheck "Notify" → Share.
   Do the same for any other sheet you connect later. The Settings page shows this email too.

Delete the downloaded key file once it's stored in Vercel.

## 2. Neon Postgres

1. Vercel → your project → **Storage → Create Database → Neon** (Marketplace) → free plan → connect it to the project. This sets `DATABASE_URL` on Vercel automatically.
2. Copy the same connection string into `.env.local`.
3. Create the tables (once, and again after any schema change):
   ```bash
   npm run db:migrate
   ```

## 3. Inngest (background jobs)

1. Vercel → **Integrations → Inngest** → install and connect it to the project. This sets `INNGEST_EVENT_KEY` and `INNGEST_SIGNING_KEY` and syncs the app on each deploy.
   (Without the integration: create an Inngest account, copy the Event key and Signing key from **Manage**, set them in Vercel, then **Apps → Sync new app** with `https://<your-vercel-domain>/api/inngest`.)
2. Local development: run the Inngest dev server next to `npm run dev`:
   ```bash
   npm run inngest:dev
   ```
   The dev server needs no keys. Open <http://localhost:8288> to watch runs.

## 4. Firecrawl and Anthropic

- `FIRECRAWL_API_KEY`: <https://www.firecrawl.dev/app/api-keys>. Each row costs about 5 to 8 credits (homepage, site map, up to 2 pages, a news search, and 1 or 2 searches for the person's X profile).
- `ANTHROPIC_API_KEY`: <https://platform.claude.com/settings/keys>. `CLAUDE_MODEL` defaults to `claude-sonnet-5-5`. Each draft is one call, plus one more only when the first draft fails a check.

## 5. Zoho Mail (Aryan's mailbox)

1. Find your Zoho region: if you log in at `mail.zoho.in` you're on **India** (`.in`); `mail.zoho.com` is US (`.com`); also `.eu`, `.com.au`.
2. Open the API console for that region: <https://api-console.zoho.in/> (or `api-console.zoho.com`, etc.) → **Add client → Server-based Applications**.
   - Client name: `TensorTonic Outreach`
   - Homepage URL: `https://<your-vercel-domain>`
   - Authorized redirect URIs: `https://<your-vercel-domain>/api/zoho/callback` (add `http://localhost:3000/api/zoho/callback` for local testing)
3. Copy **Client ID** → `ZOHO_CLIENT_ID`, **Client Secret** → `ZOHO_CLIENT_SECRET`.
4. Set the region URLs:
   - India: `ZOHO_ACCOUNTS_BASE=https://accounts.zoho.in`, `ZOHO_MAIL_API_BASE=https://mail.zoho.in`
   - US: `ZOHO_ACCOUNTS_BASE=https://accounts.zoho.com`, `ZOHO_MAIL_API_BASE=https://mail.zoho.com`
5. After deploying: sign in → **Settings → Connect Zoho Mail**. The app asks for `ZohoMail.accounts.READ` and `ZohoMail.messages.CREATE`, stores your refresh token encrypted, and makes your mailbox the sending mailbox.

Every email goes out from that one mailbox no matter who clicks Queue. Dry-run is ON until someone turns it off in Settings (you have to type SEND).

## 6. Secrets you generate yourself

```bash
openssl rand -base64 32
```

Run it twice: once for `NEXTAUTH_SECRET`, once for `ENCRYPTION_KEY` (must decode to 32 bytes). Never change `ENCRYPTION_KEY` after Zoho is connected, or you'll have to reconnect.

## 7. Vercel

1. Import the GitHub repo in Vercel (framework: Next.js, defaults are fine).
2. Add all variables from `.env.example` under **Settings → Environment Variables** (Production and Preview). Set `NEXTAUTH_URL` to the production URL.
3. Deploy. Then:
   - Sign in at `/login`.
   - Settings → **Connected sheets** → paste the sheet URL → **Tab report** to see how each tab mapped.
   - Settings → **Connect Zoho Mail**.

## Local development

```bash
cp .env.example .env.local   # fill it in
npm install
npm run db:migrate
npm run dev                   # http://localhost:3000
npm run inngest:dev           # second terminal
```

Checks: `npm test` (unit tests), `npm run typecheck`, `npm run lint`.

Draft quality preview without touching the sheet (needs only the service account, Firecrawl and Anthropic keys):

```bash
npx tsx scripts/preview-drafts.ts "Voice AI" 10
```

It writes `preview-voice-ai.md` with the hook, challenge idea, X profile, checks, and full email/LinkedIn/X text for each row.
