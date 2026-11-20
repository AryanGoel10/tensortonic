import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/auth";
import { isAllowed } from "@/lib/allowlist";
import { completeConnect } from "@/lib/zoho";
import { getSettings, updateSettings } from "@/lib/settings";
import { log, errMsg } from "@/lib/activity";

export async function GET(req: NextRequest) {
  const session = await auth();
  const email = session?.user?.email?.toLowerCase();
  if (!email || !isAllowed(email)) return NextResponse.redirect(new URL("/login", req.url));

  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const expected = req.cookies.get("zoho_oauth_state")?.value;
  const back = (q: string) => {
    const res = NextResponse.redirect(new URL(`/settings?${q}`, req.url));
    res.cookies.delete("zoho_oauth_state");
    return res;
  };
  if (url.searchParams.get("error")) return back(`zoho=error&msg=${encodeURIComponent(url.searchParams.get("error")!)}`);
  if (!code || !state || state !== expected) return back("zoho=error&msg=state_mismatch");

  try {
    const row = await completeConnect(email, code);
    const s = await getSettings();
    if (!s.sendingMailbox) await updateSettings({ sendingMailbox: email }, email);
    await log({ userEmail: email, kind: "zoho", message: `Connected Zoho mailbox ${row.fromAddress}` });
    return back("zoho=connected");
  } catch (err) {
    await log({ userEmail: email, level: "error", kind: "zoho", message: `Zoho connect failed: ${errMsg(err)}` });
    return back(`zoho=error&msg=${encodeURIComponent(errMsg(err))}`);
  }
}
