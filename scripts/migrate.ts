/**
 * Runs on every Vercel build (see package.json "build"):
 * 1. applies pending SQL migrations from ./drizzle
 * 2. creates team accounts listed in BOOTSTRAP_USERS if they don't exist yet
 *    format: "username|Display Name|password;username2|Name 2|password2"
 *    Existing accounts are never changed, so passwords changed in the app stay changed.
 */
import { config } from "dotenv";
config({ path: ".env.local" });
config();
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { migrate } from "drizzle-orm/neon-http/migrator";
import { eq } from "drizzle-orm";
import * as schema from "../src/db/schema";
import { hashPassword, normalizeUsername } from "../src/lib/passwords";

async function main() {
  const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
  if (!url) {
    console.log("[migrate] DATABASE_URL not set; skipping migrations");
    return;
  }
  const db = drizzle(neon(url), { schema });
  await migrate(db, { migrationsFolder: "./drizzle" });
  console.log("[migrate] migrations applied");

  for (const entry of (process.env.BOOTSTRAP_USERS ?? "").split(";").map((s) => s.trim()).filter(Boolean)) {
    const [rawUser, name, password] = entry.split("|");
    const username = normalizeUsername(rawUser ?? "");
    if (!username || !password) continue;
    const [existing] = await db.select().from(schema.users).where(eq(schema.users.email, username));
    if (existing?.passwordHash) continue;
    const row = { email: username, name: name || username, passwordHash: await hashPassword(password) };
    await db.insert(schema.users).values(row).onConflictDoUpdate({ target: schema.users.email, set: row });
    console.log(`[migrate] created account ${username}`);
  }
}

main().catch((err) => {
  console.error("[migrate] failed:", err);
  process.exit(1);
});
