import { redirect } from "next/navigation";
import { auth, signIn } from "@/auth";
import { isAllowed } from "@/lib/allowlist";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const session = await auth();
  if (isAllowed(session?.user?.email)) redirect("/prospects");
  const { error } = await searchParams;

  return (
    <main className="flex min-h-screen items-center justify-center bg-panel px-4">
      <div className="w-full max-w-sm rounded-xl border border-border bg-white p-8 shadow-sm">
        <div className="mb-6 flex items-center gap-2">
          <span className="inline-block h-3 w-3 rounded-sm bg-accent" />
          <span className="font-semibold">TensorTonic Outreach</span>
        </div>
        <h1 className="mb-1 text-lg font-semibold">Sign in</h1>
        <p className="mb-6 text-sm text-muted">Use your TensorTonic Google account or an allowlisted address.</p>
        {error && (
          <p className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            {error === "AccessDenied" ? "This Google account isn't on the allowlist. Ask Aryan to add it." : "Sign-in failed. Try again."}
          </p>
        )}
        <form
          action={async () => {
            "use server";
            await signIn("google", { redirectTo: "/prospects" });
          }}
        >
          <button className="flex h-10 w-full items-center justify-center gap-2 rounded-md bg-black text-sm font-medium text-white hover:bg-neutral-800">
            Continue with Google
          </button>
        </form>
      </div>
    </main>
  );
}
