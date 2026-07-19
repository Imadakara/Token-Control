import type { EntityClassDef, EntityClassId, ModuleId } from '@tokencontrol/shared';
import { ENTITY_CLASSES } from '@tokencontrol/shared';
import { asc, eq } from 'drizzle-orm';
import { entities } from '../db/schema';
import type { ServerConfig } from './config';
import type { DbLike } from './state';

/**
 * Работа с флотом игрока (ТЗ v0.02 п. 2). Порядок сущностей везде один и тот же —
 * (priority, id): по нему раздаётся общий поток ОВМ (см. game/queue.ts).
 */

export type EntityRow = typeof entities.$inferSelect;

export function entityClass(row: EntityRow): EntityClassDef {
  return ENTITY_CLASSES[row.classId as EntityClassId] ?? ENTITY_CLASSES.scout_mk1;
}

export function entityModules(row: EntityRow): ModuleId[] {
  return Array.isArray(row.modules) ? (row.modules as ModuleId[]) : [];
}

/**
 * Ключ группы: сущности в одних координатах сектора образуют группу, которой
 * можно отдать групповой приказ (ТЗ v0.02 п. 2.1). Не хранится — вычисляется.
 * Округление до coordEpsilon, а не точное равенство float'ов: цель приказа
 * `move` записывается точно, но респавн и дрейф объектов это сломают.
 */
export function groupKeyOf(row: EntityRow, cfg: ServerConfig): string {
  const eps = Math.max(1, cfg.game.coordEpsilon);
  return `${row.sectorId}|${Math.round(row.x / eps)}|${Math.round(row.y / eps)}`;
}

export async function getEntity(db: DbLike, entityId: string): Promise<EntityRow | null> {
  const [row] = await db.select().from(entities).where(eq(entities.id, entityId));
  return row ?? null;
}

/** Сущность игрока по id; null, если чужая или не существует. */
export async function getOwnedEntity(
  db: DbLike,
  pid: string,
  entityId: string,
): Promise<EntityRow | null> {
  const row = await getEntity(db, entityId);
  return row && row.playerId === pid ? row : null;
}

/**
 * Весь флот игрока в порядке раздачи ОВМ.
 * Тай-брейк по createdAt обязателен: приоритет по умолчанию у всех одинаковый,
 * и без него порядок определялся бы случайным uuid — то есть и список флота, и
 * получатель потока ОВМ менялись бы от запроса к запросу. id — последний
 * тай-брейк на случай сущностей, созданных в одной транзакции (у них общий
 * now()).
 */
export async function listEntities(db: DbLike, pid: string): Promise<EntityRow[]> {
  return db
    .select()
    .from(entities)
    .where(eq(entities.playerId, pid))
    .orderBy(asc(entities.priority), asc(entities.createdAt), asc(entities.id));
}

/** Ведущая сущность: подложка под устаревшие ship-поля и карту сектора. */
export async function leadEntity(db: DbLike, pid: string): Promise<EntityRow | null> {
  return (await listEntities(db, pid))[0] ?? null;
}

/** Автоимя вида «БОРТ-001»: порядковый номер внутри класса у этого игрока. */
async function nextName(db: DbLike, pid: string, def: EntityClassDef): Promise<string> {
  const rows = await db
    .select({ classId: entities.classId })
    .from(entities)
    .where(eq(entities.playerId, pid));
  const n = rows.filter((r) => r.classId === def.id).length + 1;
  return `${def.namePrefix}-${String(n).padStart(3, '0')}`;
}

export async function createEntity(
  db: DbLike,
  pid: string,
  classId: EntityClassId,
  sectorId: string,
  x: number,
  y: number,
): Promise<EntityRow> {
  const def = ENTITY_CLASSES[classId];
  const name = await nextName(db, pid, def);
  const [row] = await db
    .insert(entities)
    .values({
      playerId: pid,
      name,
      classId,
      sectorId,
      x,
      y,
      modules: def.baseModules,
      hp: def.hpMax,
      hpMax: def.hpMax,
    })
    .returning();
  return row!;
}
