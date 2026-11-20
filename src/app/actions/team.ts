"use server";

import { eq } from "drizzle-orm";
import { requireUser } from "@/auth";
import { db, schema } from "@/db";
import { hashPassword, normalizeUsername, passwordProblem, usernameProblem, verifyPassword } from "@/lib/passwords";
import { log } from "@/lib/activity";

type R = { ok: true } | { ok: false; error: string };

export async function listTeam() {
  const me = await requireUser();
  const rows = await db().select().from(schema.users).orderBy(schema.users.createdAt);
  return {
    me: me.email,
    users: rows.filter((r) => r.passwordHash).map((r) => ({ username: r.email, name: r.name ?? r.email, contactEmail: r.contactEmail ?? "", lastSeenAt: r.lastSeenAt })),
  };
}

export async function addTeammate(input: { username: string; name: string; password: string; contactEmail?: string }): Promise<R> {
  const me = await requireUser();
  const username = normalizeUsername(input.username);
  const bad = usernameProblem(username) ?? passwordProblem(input.password);
  if (bad) return { ok: false, error: bad };
  const [exists] = await db().select().from(schema.users).where(eq(schema.users.email, username));
  if (exists?.passwordHash) return { ok: false, error: "That username is taken." };
  const row = { email: username, name: input.name.trim() || username, passwordHash: await hashPassword(input.password), contactEmail: input.contactEmail?.trim() || null };
  await db().insert(schema.users).values(row).onConflictDoUpdate({ target: schema.users.email, set: row });
  await log({ userEmail: me.email, kind: "settings", message: `Added teammate ${username}` });
  return { ok: true };
}

export async function updateProfile(input: { name: string; contactEmail: string }): Promise<R> {
  const me = await requireUser();
  await db().update(schema.users).set({ name: input.name.trim() || me.email, contactEmail: input.contactEmail.trim() || null }).where(eq(schema.users.email, me.email));
  return { ok: true };
}

export async function changeMyPassword(current: string, next: string): Promise<R> {
  const me = await requireUser();
  const [u] = await db().select().from(schema.users).where(eq(schema.users.email, me.email));
  if (!u || !(await verifyPassword(current, u.passwordHash))) return { ok: false, error: "Current password is wrong." };
  const bad = passwordProblem(next);
  if (bad) return { ok: false, error: bad };
  await db().update(schema.users).set({ passwordHash: await hashPassword(next) }).where(eq(schema.users.email, me.email));
  await log({ userEmail: me.email, kind: "settings", message: "Changed own password" });
  return { ok: true };
}

export async function resetPassword(username: string, next: string): Promise<R> {
  const me = await requireUser();
  const bad = passwordProblem(next);
  if (bad) return { ok: false, error: bad };
  await db().update(schema.users).set({ passwordHash: await hashPassword(next), failedLogins: 0, lockedUntil: null }).where(eq(schema.users.email, normalizeUsername(username)));
  await log({ userEmail: me.email, kind: "settings", message: `Reset password for ${username}` });
  return { ok: true };
}

export async function removeTeammate(username: string): Promise<R> {
  const me = await requireUser();
  const u = normalizeUsername(username);
  if (u === me.email) return { ok: false, error: "You can't remove yourself." };
  // keep the row (activity history refers to it) but remove the ability to sign in
  await db().update(schema.users).set({ passwordHash: null }).where(eq(schema.users.email, u));
  await log({ userEmail: me.email, kind: "settings", message: `Removed teammate ${u}` });
  return { ok: true };
}
