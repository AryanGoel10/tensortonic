"use server";

import { and, desc, eq, type SQL } from "drizzle-orm";
import { requireUser } from "@/auth";
import { db, schema } from "@/db";

export async function loadActivity(filters: { user?: string; tab?: string; level?: string; kind?: string }, limit = 300) {
  await requireUser();
  const where: SQL[] = [];
  if (filters.user) where.push(eq(schema.activity.userEmail, filters.user));
  if (filters.tab) where.push(eq(schema.activity.tab, filters.tab));
  if (filters.level) where.push(eq(schema.activity.level, filters.level));
  if (filters.kind) where.push(eq(schema.activity.kind, filters.kind));
  return db()
    .select()
    .from(schema.activity)
    .where(where.length ? and(...where) : undefined)
    .orderBy(desc(schema.activity.at))
    .limit(limit);
}
