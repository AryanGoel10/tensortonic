import NextAuth, { CredentialsSignin } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { hashPassword, normalizeUsername, verifyPassword } from "@/lib/passwords";

const MAX_FAILS = 8;
const LOCK_MINUTES = 15;

class LockedError extends CredentialsSignin {
  code = "locked";
}

let dummyHash: Promise<string> | null = null;

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Credentials({
      credentials: { username: { label: "Username" }, password: { label: "Password", type: "password" } },
      async authorize(creds) {
        const username = normalizeUsername(String(creds?.username ?? ""));
        const password = String(creds?.password ?? "");
        if (!username || !password) return null;
        const [u] = await db().select().from(schema.users).where(eq(schema.users.email, username));
        if (!u || !u.passwordHash) {
          // same work as a real check so response time doesn't reveal which usernames exist
          dummyHash ??= hashPassword("not-a-real-password");
          await verifyPassword(password, await dummyHash);
          return null;
        }
        if (u.lockedUntil && u.lockedUntil.getTime() > Date.now()) throw new LockedError();
        if (!(await verifyPassword(password, u.passwordHash))) {
          const fails = u.failedLogins + 1;
          const lock = fails >= MAX_FAILS;
          await db()
            .update(schema.users)
            .set({ failedLogins: lock ? 0 : fails, lockedUntil: lock ? new Date(Date.now() + LOCK_MINUTES * 60_000) : null })
            .where(eq(schema.users.email, username));
          return null;
        }
        await db().update(schema.users).set({ failedLogins: 0, lockedUntil: null, lastSeenAt: new Date() }).where(eq(schema.users.email, username));
        return { id: u.email, email: u.email, name: u.name ?? u.email };
      },
    }),
  ],
  secret: process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET,
  trustHost: true,
  session: { strategy: "jwt", maxAge: 30 * 24 * 3600 },
  pages: { signIn: "/login", error: "/login" },
});

export interface AppUser {
  email: string; // the login username
  name: string;
  contactEmail: string | null;
}

/** Signed-in user, or null. Re-checks the account on every request, so removing someone signs them out. */
export async function currentUser(): Promise<AppUser | null> {
  const session = await auth();
  const username = session?.user?.email?.toLowerCase();
  if (!username) return null;
  const [u] = await db().select().from(schema.users).where(eq(schema.users.email, username));
  if (!u || !u.passwordHash) return null;
  return { email: u.email, name: u.name ?? u.email, contactEmail: u.contactEmail };
}

/** For server components and actions. Redirects to /login when signed out. */
export async function requireUser(): Promise<AppUser> {
  const u = await currentUser();
  if (!u) redirect("/login");
  return u;
}
