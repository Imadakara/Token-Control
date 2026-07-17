import { and, isNotNull, lte, sql } from 'drizzle-orm';
import type { Db } from '../db/client';
import { objects } from '../db/schema';

/** Восстановление исчерпанных запасов по таймеру (ТЗ п. 8). */
export async function regenerateResources(db: Db): Promise<number> {
  const rows = await db
    .update(objects)
    .set({ resourceAmount: sql`${objects.maxResource}`, respawnAt: null })
    .where(and(isNotNull(objects.respawnAt), lte(objects.respawnAt, new Date())))
    .returning({ id: objects.id });
  return rows.length;
}

export function startRegenTimer(db: Db, intervalMs = 60_000): NodeJS.Timeout {
  const timer = setInterval(() => {
    regenerateResources(db).catch((err) => console.error('regen failed:', err));
  }, intervalMs);
  timer.unref();
  return timer;
}
