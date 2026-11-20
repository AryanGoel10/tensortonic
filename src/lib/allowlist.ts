/** Sign-in allowlist: any address on ALLOWED_DOMAIN plus the emails in ALLOWED_EMAILS. */
export function isAllowed(email: string | null | undefined, env: Record<string, string | undefined> = process.env): boolean {
  if (!email) return false;
  const e = email.trim().toLowerCase();
  const list = (env.ALLOWED_EMAILS ?? "")
    .split(",")
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);
  if (list.includes(e)) return true;
  const domain = (env.ALLOWED_DOMAIN ?? "").trim().toLowerCase().replace(/^@/, "");
  return !!domain && e.endsWith(`@${domain}`);
}
