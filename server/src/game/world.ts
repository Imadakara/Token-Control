import { eq } from 'drizzle-orm';
import { objects, sectors, visitedSectors } from '../db/schema';
import type { DbLike } from './state';
import { generateSector, parseSectorId, type WorldGenParams } from './worldgen';

/** Ленивая генерация: создаёт сектор и его объекты при первом обращении. */
export async function ensureSectorGenerated(
  db: DbLike,
  sectorId: string,
  world: WorldGenParams,
): Promise<void> {
  const existing = await db.select({ id: sectors.id }).from(sectors).where(eq(sectors.id, sectorId));
  if (existing.length > 0) return;

  const coords = parseSectorId(sectorId);
  if (!coords) throw new Error(`bad sector id: ${sectorId}`);

  const generated = generateSector(sectorId, world);
  await db.transaction(async (tx) => {
    const inserted = await tx
      .insert(sectors)
      .values({ id: sectorId, gx: coords.gx, gy: coords.gy })
      .onConflictDoNothing()
      .returning({ id: sectors.id });
    // Гонка: другой запрос успел сгенерировать — объекты не дублируем
    if (inserted.length === 0) return;
    if (generated.length > 0) {
      await tx.insert(objects).values(generated.map((o) => ({ sectorId, ...o })));
    }
  });
}

export async function markVisited(db: DbLike, playerId: string, sectorId: string): Promise<void> {
  await db.insert(visitedSectors).values({ playerId, sectorId }).onConflictDoNothing();
}
