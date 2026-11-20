import { desc, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { DEFAULT_SETTINGS, VERSIONED_KEYS, type AppSettings } from "./settings-defaults";

export async function getSettings(): Promise<AppSettings> {
  const rows = await db().select().from(schema.settings);
  const out: AppSettings = { ...DEFAULT_SETTINGS };
  for (const r of rows) {
    if (r.key in out) (out as unknown as Record<string, unknown>)[r.key] = r.value;
  }
  return out;
}

export async function updateSettings(patch: Partial<AppSettings>, by: string) {
  const current = await getSettings();
  for (const [key, value] of Object.entries(patch) as [keyof AppSettings, unknown][]) {
    if (!(key in DEFAULT_SETTINGS)) continue;
    if (JSON.stringify(current[key]) === JSON.stringify(value)) continue;
    await db()
      .insert(schema.settings)
      .values({ key, value: value as object, updatedBy: by, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: schema.settings.key,
        set: { value: value as object, updatedBy: by, updatedAt: new Date() },
      });
    if (VERSIONED_KEYS.includes(key)) {
      await db().insert(schema.settingsHistory).values({ key, value: value as object, updatedBy: by });
      // keep the last 10 versions per key
      const old = await db()
        .select({ id: schema.settingsHistory.id })
        .from(schema.settingsHistory)
        .where(eq(schema.settingsHistory.key, key))
        .orderBy(desc(schema.settingsHistory.updatedAt))
        .offset(10);
      if (old.length)
        await db()
          .delete(schema.settingsHistory)
          .where(inArray(schema.settingsHistory.id, old.map((o) => o.id)));
    }
  }
}

export async function getHistory(key: string) {
  return db()
    .select()
    .from(schema.settingsHistory)
    .where(eq(schema.settingsHistory.key, key))
    .orderBy(desc(schema.settingsHistory.updatedAt))
    .limit(10);
}
