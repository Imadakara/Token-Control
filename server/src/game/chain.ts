import { and, eq, or } from 'drizzle-orm';
import { chainKeys, entities, players, sectorLinks } from '../db/schema';
import { QueueError } from './queue';
import type { DbLike } from './state';

/**
 * Цепь Миров (ТЗ v0.02 п. 4): рёбра между секторами, по которым возможен
 * гиперпрыжок. Глобальная топология, общая для всех игроков — секрет не
 * ребро, а содержимое самих секторов (это уже прячет known_objects).
 */

/** Ребро неориентированное — храним в одном каноническом порядке. */
function canonicalPair(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

export async function areLinked(db: DbLike, a: string, b: string): Promise<boolean> {
  if (a === b) return true; // сектор всегда «связан» сам с собой
  const [x, y] = canonicalPair(a, b);
  const [row] = await db
    .select({ a: sectorLinks.aSectorId })
    .from(sectorLinks)
    .where(and(eq(sectorLinks.aSectorId, x), eq(sectorLinks.bSectorId, y)));
  return !!row;
}

export async function linkSectors(db: DbLike, a: string, b: string): Promise<void> {
  if (a === b) return;
  const [x, y] = canonicalPair(a, b);
  await db.insert(sectorLinks).values({ aSectorId: x, bSectorId: y }).onConflictDoNothing();
}

/** Сектора, где есть хоть чьи-то врата (ТЗ: наличие врат подключает к Цепи). */
export async function sectorsWithGates(db: DbLike, exclude?: string): Promise<string[]> {
  const rows = await db
    .selectDistinct({ sectorId: entities.sectorId })
    .from(entities)
    .where(eq(entities.classId, 'gate'));
  return rows.map((r) => r.sectorId).filter((id) => id !== exclude);
}

export async function hasGateInSector(db: DbLike, pid: string, sectorId: string): Promise<boolean> {
  const rows = await db
    .select({ id: entities.id })
    .from(entities)
    .where(and(eq(entities.playerId, pid), eq(entities.sectorId, sectorId), eq(entities.classId, 'gate')));
  return rows.length > 0;
}

/**
 * Авто-подключение к Цепи по завершении build_gate (ТЗ п. 4): к случайному
 * сектору, где уже есть чьи-то врата, либо ничего — если этот сектор первый
 * (тогда он просто становится узлом Цепи без рёбер, пока кто-то не подключится).
 * Момент случаен намеренно: это игровое событие «куда тебя вынесло», а не
 * контент, которому нужна повторяемость сида (в отличие от worldgen).
 */
export async function joinChainOnGateBuilt(db: DbLike, sectorId: string): Promise<string | null> {
  const others = await sectorsWithGates(db, sectorId);
  if (others.length === 0) return null;
  const target = others[Math.floor(Math.random() * others.length)]!;
  await linkSectors(db, sectorId, target);
  return target;
}

/** Сектора, связанные ребром напрямую с данным (BFS дальше не идёт — Цепь плоская по дизайну ТЗ). */
export async function linkedSectorIds(db: DbLike, sectorId: string): Promise<string[]> {
  const rows = await db
    .select()
    .from(sectorLinks)
    .where(or(eq(sectorLinks.aSectorId, sectorId), eq(sectorLinks.bSectorId, sectorId)));
  return rows.map((r) => (r.aSectorId === sectorId ? r.bSectorId : r.aSectorId));
}

/** Все сектора, достижимые от данного по рёбрам Цепи (любой длины пути). */
export async function reachableSectors(db: DbLike, from: string): Promise<string[]> {
  const allLinks = await db.select().from(sectorLinks);
  const adj = new Map<string, string[]>();
  for (const l of allLinks) {
    (adj.get(l.aSectorId) ?? adj.set(l.aSectorId, []).get(l.aSectorId)!).push(l.bSectorId);
    (adj.get(l.bSectorId) ?? adj.set(l.bSectorId, []).get(l.bSectorId)!).push(l.aSectorId);
  }
  const seen = new Set<string>([from]);
  const queue = [from];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    for (const next of adj.get(cur) ?? []) {
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  seen.delete(from);
  return [...seen];
}

/** Все рёбра Цепи — для отрисовки карты галактики. */
export async function allChainLinks(db: DbLike): Promise<{ a: string; b: string }[]> {
  const rows = await db.select().from(sectorLinks);
  return rows.map((r) => ({ a: r.aSectorId, b: r.bSectorId }));
}

export async function playerChainKeys(db: DbLike, pid: string) {
  return db.select().from(chainKeys).where(eq(chainKeys.playerId, pid));
}

/**
 * Применение ключа (ТЗ п. 4, точка монетизации): подключает ДОМАШНИЙ сектор
 * игрока к другому — конкретному (targetSectorId ключа) или случайному среди
 * уже подключённых к Цепи. Требует собственных врат в домашнем секторе —
 * ключ открывает канал, а не строит инфраструктуру с нуля.
 */
export async function connectChainKey(db: DbLike, pid: string, keyId: string): Promise<void> {
  const [key] = await db
    .select()
    .from(chainKeys)
    .where(and(eq(chainKeys.id, keyId), eq(chainKeys.playerId, pid)));
  if (!key) throw new QueueError('КЛЮЧ НЕ НАЙДЕН');
  if (key.consumedAt) throw new QueueError('КЛЮЧ УЖЕ ИСПОЛЬЗОВАН');

  const [player] = await db.select().from(players).where(eq(players.id, pid));
  const homeSectorId = player?.homeSectorId;
  if (!homeSectorId) throw new QueueError('НЕТ ДОМАШНЕГО СЕКТОРА');
  if (!(await hasGateInSector(db, pid, homeSectorId))) {
    throw new QueueError('НЕТ ВРАТ В ДОМАШНЕМ СЕКТОРЕ');
  }

  let target = key.targetSectorId;
  if (!target) {
    const candidates = await sectorsWithGates(db, homeSectorId);
    if (candidates.length === 0) throw new QueueError('НЕТ ДОСТУПНЫХ МИРОВ В ЦЕПИ');
    target = candidates[Math.floor(Math.random() * candidates.length)]!;
  }

  await linkSectors(db, homeSectorId, target);
  await db.update(chainKeys).set({ consumedAt: new Date() }).where(eq(chainKeys.id, key.id));
}
