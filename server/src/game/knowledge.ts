import { findTech, TECHS, type TechStatus } from '@tokencontrol/shared';
import { and, eq } from 'drizzle-orm';
import { players, playerKnowledge, playerTech } from '../db/schema';
import { lockPlayer, QueueError } from './queue';
import { r3, type DbLike } from './state';

/**
 * Прогресс игрока по Базе Знаний и Технологиям (ТЗ v0.02 пп. 5–6). Контент —
 * статичный каталог в @tokencontrol/shared/knowledge.ts; здесь только чтение
 * и изменение того, что игрок открыл/изучил.
 */

export async function unlockedEntryIds(db: DbLike, pid: string): Promise<Set<string>> {
  const rows = await db
    .select({ entryId: playerKnowledge.entryId })
    .from(playerKnowledge)
    .where(eq(playerKnowledge.playerId, pid));
  return new Set(rows.map((r) => r.entryId));
}

export async function researchedTechIds(db: DbLike, pid: string): Promise<Set<string>> {
  const rows = await db
    .select({ techId: playerTech.techId })
    .from(playerTech)
    .where(eq(playerTech.playerId, pid));
  return new Set(rows.map((r) => r.techId));
}

export async function hasTech(db: DbLike, pid: string, techId: string): Promise<boolean> {
  const [row] = await db
    .select({ techId: playerTech.techId })
    .from(playerTech)
    .where(and(eq(playerTech.playerId, pid), eq(playerTech.techId, techId)));
  return !!row;
}

/** Разблокировать запись Базы Знаний (вызывается из executeAction('upload_data')). */
export async function unlockEntry(db: DbLike, pid: string, entryId: string): Promise<void> {
  await db.insert(playerKnowledge).values({ playerId: pid, entryId }).onConflictDoNothing();
}

/**
 * Статус каждой технологии для конкретного игрока — то, что отдаёт GET /tech.
 * `researchable` учитывает и текущий буфер ОВМ, поэтому может устареть за
 * секунды — как и OrderOption.available, это нормально (см. game/orders.ts).
 */
export async function listTechStatus(db: DbLike, pid: string): Promise<TechStatus[]> {
  const researched = await researchedTechIds(db, pid);
  const known = await unlockedEntryIds(db, pid);
  const [player] = await db.select().from(players).where(eq(players.id, pid));
  const buffer = Number(player?.ovmBuffer ?? 0);

  return TECHS.map((tech) => {
    const isResearched = researched.has(tech.id);
    const missingRequires = tech.requires.filter((r) => !researched.has(r));
    const missingEntries = tech.dataCost.entryIds.filter((id) => !known.has(id));
    const researchable =
      !isResearched &&
      missingRequires.length === 0 &&
      missingEntries.length === 0 &&
      buffer >= tech.dataCost.ovm;
    return { ...tech, researched: isResearched, researchable, missingRequires, missingEntries };
  });
}

/**
 * Исследование — не приказ флоту, а мгновенное действие интерфейса управления
 * (ТЗ v0.02 п. 6): списывает dataCost.ovm из общего буфера сразу, минуя
 * очередь приказов. Та же блокировка (`lockPlayer`), что и у постановки
 * приказов, — сериализация относительно любых других трат буфера.
 */
export async function researchTech(db: DbLike, pid: string, techId: string): Promise<void> {
  const tech = findTech(techId);
  if (!tech) throw new QueueError('НЕИЗВЕСТНАЯ ТЕХНОЛОГИЯ');

  const buffer = await lockPlayer(db, pid);
  if (await hasTech(db, pid, techId)) throw new QueueError('УЖЕ ИЗУЧЕНА');

  const researched = await researchedTechIds(db, pid);
  const missingReq = tech.requires.find((r) => !researched.has(r));
  if (missingReq) throw new QueueError(`ТРЕБУЕТСЯ: ${findTech(missingReq)?.title ?? missingReq}`);

  const known = await unlockedEntryIds(db, pid);
  if (tech.dataCost.entryIds.some((id) => !known.has(id))) {
    throw new QueueError('НЕДОСТАТОЧНО ДАННЫХ В БАЗЕ ЗНАНИЙ');
  }
  if (buffer < tech.dataCost.ovm) throw new QueueError('НЕДОСТАТОЧНО ОВМ');

  await db
    .update(players)
    .set({ ovmBuffer: String(r3(buffer - tech.dataCost.ovm)) })
    .where(eq(players.id, pid));
  await db.insert(playerTech).values({ playerId: pid, techId }).onConflictDoNothing();
}
