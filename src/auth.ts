import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { redirect } from "next/navigation";
import { isAllowed } from "@/lib/allowlist";
import { db, schema } from "@/db";

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    }),
  ],
  secret: process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET,
  trustHost: true,
  session: { strategy: "jwt" },
  pages: { signIn: "/login", error: "/login" },
  callbacks: {
    async signIn({ user, profile }) {
      const email = user.email ?? (profile?.email as string | undefined);
      // Google must have verified the address, and it must be on the allowlist.
      if (profile && (profile as { email_verified?: boolean }).email_verified === false) return false;
      if (!isAllowed(email)) return false;
      try {
        await db()
          .insert(schema.users)
          .values({ email: email!.toLowerCase(), name: user.name ?? null, image: user.image ?? null })
          .onConflictDoUpdate({
            target: schema.users.email,
            set: { name: user.name ?? null, image: user.image ?? null, lastSeenAt: new Date() },
          });
      } catch (err) {
        console.error("user upsert failed", err);
      }
      return true;
    },
    async session({ session }) {
      // Re-check on every request so removing someone from the allowlist takes effect immediately.
      if (!isAllowed(session.user?.email)) return { ...session, user: undefined as never };
      return session;
    },
  },
});

export interface AppUser {
  email: string;
  name: string;
}

/** For server components / actions. Redirects to /login when signed out or not allowed. */
export async function requireUser(): Promise<AppUser> {
  const session = await auth();
  const email = session?.user?.email?.toLowerCase();
  if (!email || !isAllowed(email)) redirect("/login");
  return { email, name: session?.user?.name ?? email.split("@")[0] };
}
