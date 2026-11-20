// Zoho Mail REST API. Verified against Zoho docs (Nov 2026):
//   POST {MAIL_API}/api/accounts/{accountId}/messages
//   body: fromAddress, toAddress, subject, content, mailFormat ("plaintext" | "html")
//   header: Authorization: Zoho-oauthtoken <token>
//   scope: ZohoMail.messages.CREATE (send), ZohoMail.accounts.READ (account lookup)
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { decrypt, encrypt } from "./crypto";

export const ZOHO_SCOPES = ["ZohoMail.accounts.READ", "ZohoMail.messages.CREATE"];

const accountsBase = () => (process.env.ZOHO_ACCOUNTS_BASE || "https://accounts.zoho.com").replace(/\/$/, "");
const mailBase = () => (process.env.ZOHO_MAIL_API_BASE || "https://mail.zoho.com").replace(/\/$/, "");

export function redirectUri(): string {
  const base = (process.env.NEXTAUTH_URL || process.env.AUTH_URL || "http://localhost:3000").replace(/\/$/, "");
  return `${base}/api/zoho/callback`;
}

export function authorizeUrl(state: string): string {
  const u = new URL(`${accountsBase()}/oauth/v2/auth`);
  u.searchParams.set("scope", ZOHO_SCOPES.join(","));
  u.searchParams.set("client_id", process.env.ZOHO_CLIENT_ID ?? "");
  u.searchParams.set("response_type", "code");
  u.searchParams.set("access_type", "offline");
  u.searchParams.set("prompt", "consent");
  u.searchParams.set("redirect_uri", redirectUri());
  u.searchParams.set("state", state);
  return u.toString();
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  api_domain?: string;
  error?: string;
}

async function tokenRequest(params: Record<string, string>): Promise<TokenResponse> {
  const body = new URLSearchParams({
    client_id: process.env.ZOHO_CLIENT_ID ?? "",
    client_secret: process.env.ZOHO_CLIENT_SECRET ?? "",
    ...params,
  });
  const res = await fetch(`${accountsBase()}/oauth/v2/token`, { method: "POST", body });
  const json = (await res.json().catch(() => ({}))) as TokenResponse;
  if (!res.ok || json.error) throw new Error(`Zoho token error: ${json.error ?? res.status}`);
  return json;
}

interface ZohoAccount {
  accountId: string;
  emailAddress?: string;
  isDefaultAccount?: boolean;
  primaryEmailAddress?: string;
  mailboxAddress?: string;
  displayName?: string;
  sendMailDetails?: { fromAddress?: string; displayName?: string; status?: boolean }[];
}

async function listAccounts(accessToken: string): Promise<ZohoAccount[]> {
  const res = await fetch(`${mailBase()}/api/accounts`, {
    headers: { Authorization: `Zoho-oauthtoken ${accessToken}` },
  });
  const json = (await res.json().catch(() => ({}))) as {
    data?: ZohoAccount[] | { primaryAccount?: ZohoAccount };
    status?: { description?: string };
  };
  if (!res.ok) throw new Error(`Zoho accounts error ${res.status}: ${json.status?.description ?? ""}`);
  const d = json.data;
  if (Array.isArray(d)) return [...d].sort((a, b) => Number(!!b.isDefaultAccount) - Number(!!a.isDefaultAccount));
  return d?.primaryAccount ? [d.primaryAccount] : [];
}

/** Exchange the OAuth code, look up the mailbox and store it encrypted. */
export async function completeConnect(userEmail: string, code: string) {
  const tok = await tokenRequest({ grant_type: "authorization_code", code, redirect_uri: redirectUri() });
  if (!tok.access_token || !tok.refresh_token)
    throw new Error("Zoho did not return a refresh token. Remove the app from Zoho connected apps and try again.");
  const accounts = await listAccounts(tok.access_token);
  const acct = accounts[0];
  if (!acct) throw new Error("No Zoho Mail account found for this login");
  // primaryEmailAddress is the Zoho LOGIN (can be a personal Gmail). Send from the mailbox address.
  const fromAddress =
    acct.mailboxAddress ?? acct.emailAddress ?? acct.sendMailDetails?.find((d) => d.fromAddress)?.fromAddress ?? acct.primaryEmailAddress;
  if (!fromAddress) throw new Error("Couldn't find a from address on the Zoho account");

  const row = {
    userEmail,
    accountId: String(acct.accountId),
    fromAddress,
    displayName: acct.displayName ?? acct.sendMailDetails?.[0]?.displayName ?? null,
    refreshTokenEnc: encrypt(tok.refresh_token),
    accessTokenEnc: encrypt(tok.access_token),
    accessExpiresAt: new Date(Date.now() + ((tok.expires_in ?? 3600) - 120) * 1000),
    connectedAt: new Date(),
  };
  await db()
    .insert(schema.zohoAccounts)
    .values(row)
    .onConflictDoUpdate({ target: schema.zohoAccounts.userEmail, set: row });
  return row;
}

export async function getMailbox(userEmail: string) {
  const [row] = await db().select().from(schema.zohoAccounts).where(eq(schema.zohoAccounts.userEmail, userEmail));
  return row ?? null;
}

async function accessToken(userEmail: string, force = false): Promise<{ token: string; accountId: string; fromAddress: string }> {
  const row = await getMailbox(userEmail);
  if (!row) throw new Error(`No Zoho mailbox connected for ${userEmail}`);
  if (!force && row.accessTokenEnc && row.accessExpiresAt && row.accessExpiresAt.getTime() > Date.now()) {
    return { token: decrypt(row.accessTokenEnc), accountId: row.accountId, fromAddress: row.fromAddress };
  }
  const tok = await tokenRequest({ grant_type: "refresh_token", refresh_token: decrypt(row.refreshTokenEnc) });
  if (!tok.access_token) throw new Error("Zoho refresh failed");
  await db()
    .update(schema.zohoAccounts)
    .set({
      accessTokenEnc: encrypt(tok.access_token),
      accessExpiresAt: new Date(Date.now() + ((tok.expires_in ?? 3600) - 120) * 1000),
    })
    .where(eq(schema.zohoAccounts.userEmail, userEmail));
  return { token: tok.access_token, accountId: row.accountId, fromAddress: row.fromAddress };
}

/** Send one plain-text email from the mailbox owned by `userEmail`. Refreshes the token on 401. */
export async function sendMail(userEmail: string, to: string, subject: string, content: string, fromName?: string): Promise<{ messageId: string }> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const { token, accountId, fromAddress } = await accessToken(userEmail, attempt > 0);
    const res = await fetch(`${mailBase()}/api/accounts/${accountId}/messages`, {
      method: "POST",
      headers: { Authorization: `Zoho-oauthtoken ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ fromAddress: fromName?.trim() ? `"${fromName.trim().replace(/"/g, "")}" <${fromAddress}>` : fromAddress, toAddress: to, subject, content, mailFormat: "plaintext", encoding: "UTF-8" }),
    });
    if (res.status === 401 && attempt === 0) continue;
    const json = (await res.json().catch(() => ({}))) as {
      data?: { messageId?: string | number; mailId?: string };
      status?: { code?: number; description?: string };
    };
    if (!res.ok || (json.status?.code && json.status.code >= 400)) {
      throw new Error(`Zoho send failed ${res.status}: ${json.status?.description ?? JSON.stringify(json).slice(0, 300)}`);
    }
    return { messageId: String(json.data?.messageId ?? json.data?.mailId ?? "") };
  }
  throw new Error("Zoho send failed after token refresh");
}
