import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { currentUser } from "@/auth";
import { authorizeUrl } from "@/lib/zoho";

export async function GET(req: Request) {
  if (!(await currentUser())) return NextResponse.redirect(new URL("/login", req.url));
  const state = randomBytes(16).toString("hex");
  const res = NextResponse.redirect(authorizeUrl(state));
  res.cookies.set("zoho_oauth_state", state, { httpOnly: true, secure: true, sameSite: "lax", maxAge: 600, path: "/" });
  return res;
}
