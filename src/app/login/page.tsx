import { redirect } from "next/navigation";
import { AuthError } from "next-auth";
import { currentUser, signIn } from "@/auth";

const MESSAGES: Record<string, string> = {
  credentials: "Wrong username or password.",
  locked: "Too many wrong attempts. Try again in 15 minutes.",
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string; code?: string }> }) {
  if (await currentUser().catch(() => null)) redirect("/prospects");
  const { error, code } = await searchParams;
  const message = error ? MESSAGES[code ?? ""] ?? MESSAGES.credentials : "";

  return (
    <main className="flex min-h-screen items-center justify-center bg-panel px-4">
      <div className="w-full max-w-sm rounded-xl border border-border bg-white p-8 shadow-sm">
        <div className="mb-6 flex items-center gap-2">
          <span className="inline-block h-3 w-3 rounded-sm bg-accent" />
          <span className="font-semibold">TensorTonic Outreach</span>
        </div>
        <h1 className="mb-6 text-lg font-semibold">Sign in</h1>
        {message && <p className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{message}</p>}
        <form
          className="space-y-3"
          action={async (form: FormData) => {
            "use server";
            try {
              await signIn("credentials", {
                username: String(form.get("username") ?? ""),
                password: String(form.get("password") ?? ""),
                redirectTo: "/prospects",
              });
            } catch (err) {
              if (err instanceof AuthError) {
                const c = (err as AuthError & { code?: string }).code ?? "credentials";
                redirect(`/login?error=1&code=${encodeURIComponent(c)}`);
              }
              throw err; // the success redirect
            }
          }}
        >
          <label className="block text-sm">
            <span className="mb-1 block text-xs font-medium text-muted">Username</span>
            <input name="username" autoComplete="username" required autoFocus className="h-10 w-full rounded-md border border-border px-3" />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-xs font-medium text-muted">Password</span>
            <input name="password" type="password" autoComplete="current-password" required className="h-10 w-full rounded-md border border-border px-3" />
          </label>
          <button className="h-10 w-full rounded-md bg-black text-sm font-medium text-white hover:bg-neutral-800">Sign in</button>
        </form>
      </div>
    </main>
  );
}
