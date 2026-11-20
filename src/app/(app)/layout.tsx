import Link from "next/link";
import { requireUser, signOut } from "@/auth";
import { getSettings } from "@/lib/settings";
import { NavLinks } from "@/components/nav";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  let dryRun = true;
  try {
    dryRun = (await getSettings()).dryRun;
  } catch {
    // database not configured yet; layout still renders
  }
  return (
    <div className="min-h-screen bg-panel">
      <header className="sticky top-0 z-20 border-b border-border bg-white">
        <div className="mx-auto flex h-14 max-w-[1400px] items-center gap-6 px-4">
          <Link href="/prospects" className="flex items-center gap-2 font-semibold">
            <span className="inline-block h-3 w-3 rounded-sm bg-accent" />
            Outreach
          </Link>
          <NavLinks />
          <div className="ml-auto flex items-center gap-3 text-sm">
            {dryRun ? (
              <Link href="/settings" className="rounded border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800">DRY RUN</Link>
            ) : (
              <Link href="/settings" className="rounded border border-red-300 bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700">LIVE SENDING</Link>
            )}
            <span className="hidden text-muted sm:inline">{user.email}</span>
            <form
              action={async () => {
                "use server";
                await signOut({ redirectTo: "/login" });
              }}
            >
              <button className="text-muted hover:text-black">Sign out</button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-[1400px] px-4 py-6">{children}</main>
    </div>
  );
}
