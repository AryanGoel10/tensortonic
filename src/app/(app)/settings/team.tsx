"use client";

import { useEffect, useState } from "react";
import { Button, Card, Notice } from "@/components/ui";
import { addTeammate, changeMyPassword, listTeam, removeTeammate, resetPassword, updateProfile } from "@/app/actions/team";

type Team = Awaited<ReturnType<typeof listTeam>>;

export function TeamCard() {
  const [team, setTeam] = useState<Team | null>(null);
  const [msg, setMsg] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [nu, setNu] = useState({ username: "", name: "", password: "", contactEmail: "" });
  const [pw, setPw] = useState({ current: "", next: "" });
  const load = () => listTeam().then(setTeam);
  useEffect(() => {
    load();
  }, []);
  const done = (r: { ok: boolean; error?: string }, okText: string) => {
    setMsg(r.ok ? { tone: "ok", text: okText } : { tone: "error", text: r.error ?? "Failed" });
    if (r.ok) load();
    return r.ok;
  };
  if (!team) return null;
  const me = team.users.find((u) => u.username === team.me);

  return (
    <Card className="space-y-4 p-5">
      <h2 className="font-semibold">Team</h2>
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-muted">
          <tr><th className="py-1">Username</th><th>Name</th><th>Email for test sends</th><th>Last seen</th><th /></tr>
        </thead>
        <tbody>
          {team.users.map((u) => (
            <tr key={u.username} className="border-t border-border">
              <td className="py-1.5 font-medium">{u.username}{u.username === team.me && " (you)"}</td>
              <td>{u.name}</td>
              <td className="text-xs">{u.contactEmail || <span className="text-muted">not set</span>}</td>
              <td className="text-xs text-muted">{new Date(u.lastSeenAt).toLocaleDateString()}</td>
              <td className="text-right">
                {u.username !== team.me && (
                  <span className="space-x-1">
                    <Button size="sm" variant="ghost" onClick={async () => {
                      const p = prompt(`New password for ${u.username} (at least 10 characters):`);
                      if (p) done(await resetPassword(u.username, p), `Password reset for ${u.username}. Send it to them privately.`);
                    }}>Reset password</Button>
                    <Button size="sm" variant="ghost" onClick={async () => {
                      if (confirm(`Remove ${u.username}? They won't be able to sign in.`)) done(await removeTeammate(u.username), `${u.username} removed.`);
                    }}>Remove</Button>
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="grid gap-4 md:grid-cols-2">
        <form className="space-y-2 rounded-md border border-border p-3" onSubmit={async (e) => {
          e.preventDefault();
          if (done(await addTeammate(nu), `Added ${nu.username}. Send them the password privately.`)) setNu({ username: "", name: "", password: "", contactEmail: "" });
        }}>
          <div className="text-xs font-medium text-muted">Add a teammate</div>
          <input required placeholder="username (e.g. shivam)" value={nu.username} onChange={(e) => setNu({ ...nu, username: e.target.value })} className="h-8 w-full rounded-md border border-border px-2 text-sm" />
          <input placeholder="Display name (e.g. Shivam)" value={nu.name} onChange={(e) => setNu({ ...nu, name: e.target.value })} className="h-8 w-full rounded-md border border-border px-2 text-sm" />
          <input placeholder="Their email (optional, for test sends)" value={nu.contactEmail} onChange={(e) => setNu({ ...nu, contactEmail: e.target.value })} className="h-8 w-full rounded-md border border-border px-2 text-sm" />
          <input required type="text" placeholder="Password (10+ characters)" value={nu.password} onChange={(e) => setNu({ ...nu, password: e.target.value })} className="h-8 w-full rounded-md border border-border px-2 text-sm" />
          <Button size="sm" variant="primary">Add</Button>
        </form>

        <div className="space-y-3">
          {me && (
            <form className="space-y-2 rounded-md border border-border p-3" onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              done(await updateProfile({ name: String(f.get("name")), contactEmail: String(f.get("contactEmail")) }), "Profile saved.");
            }}>
              <div className="text-xs font-medium text-muted">Your profile (your name is what &quot;Mark LinkedIn sent&quot; writes to the sheet)</div>
              <input name="name" defaultValue={me.name} className="h-8 w-full rounded-md border border-border px-2 text-sm" />
              <input name="contactEmail" defaultValue={me.contactEmail} placeholder="Your email for test sends" className="h-8 w-full rounded-md border border-border px-2 text-sm" />
              <Button size="sm">Save</Button>
            </form>
          )}
          <form className="space-y-2 rounded-md border border-border p-3" onSubmit={async (e) => {
            e.preventDefault();
            if (done(await changeMyPassword(pw.current, pw.next), "Password changed.")) setPw({ current: "", next: "" });
          }}>
            <div className="text-xs font-medium text-muted">Change your password</div>
            <input required type="password" autoComplete="current-password" placeholder="Current password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} className="h-8 w-full rounded-md border border-border px-2 text-sm" />
            <input required type="password" autoComplete="new-password" placeholder="New password (10+ characters)" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} className="h-8 w-full rounded-md border border-border px-2 text-sm" />
            <Button size="sm">Change password</Button>
          </form>
        </div>
      </div>
    </Card>
  );
}
