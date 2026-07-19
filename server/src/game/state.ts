import type {
  CargoItem,
  EntityClassId,
  EntityState,
  EntityStatus,
  ModuleId,
  QueueTask,
  StateResponse,
} from '@tokencontrol/shared';
import { ENTITY_CLASSES } from '@tokencontrol/shared';
import { asc, eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { cargo, entities, players, queues } from '../db/schema';
import type { ServerConfig } from './config';

/** И db, и транзакция — у обоих одинаковый query-интерфейс. */
export type DbLike = Db | Parameters<Parameters<Db['transaction']>[0]>[0];

export function r3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

type EntityRow = typeof entities.$inferSelect;

function classOf(row: EntityRow) {
  return ENTITY_CLASSES[row.classId as EntityClassId] ?? ENTITY_CLASSES.scout_mk1;
}

/**
 * Статус сущности (ТЗ v0.02 п. 2). Вычисляется, не хранится.
 * `busy` получает та сущность, в которую сейчас реально течёт общий поток ОВМ,
 * то есть первая по приоритету с активным приказом; остальные с приказами —
 * `starved`. Это честно отражает приоритетную раздачу.
 */
function statusOf(row: EntityRow, orders: QueueTask[], receivingFlow: boolean): EntityStatus {
  const head = orders[0];
  if (head && head.status === 'active') return receivingFlow ? 'busy' : 'starved';
  if (head) return 'starved';
  if (row.dockedObjectId) return 'docked';
  if (row.hp < row.hpMax) return 'damaged';
  return 'idle';
}

/** Снапшот состояния игрока для терминала; переиспользуется всеми маршрутами и WS. */
export async function buildState(
  db: DbLike,
  cfg: ServerConfig,
  pid: string,
): Promise<StateResponse | null> {
  const [playerRow] = await db.select().from(players).where(eq(players.id, pid));
  if (!playerRow) return null;

  // Порядок обязан совпадать с listEntities: он же порядок раздачи ОВМ
  const entityRows = await db
    .select()
    .from(entities)
    .where(eq(entities.playerId, pid))
    .orderBy(asc(entities.priority), asc(entities.createdAt), asc(entities.id));
  if (entityRows.length === 0) return null;

  // Одним запросом на игрока — ради этого в queues оставлен player_id с индексом
  const queueRows = await db
    .select()
    .from(queues)
    .where(eq(queues.playerId, pid))
    .orderBy(asc(queues.slot));
  const cargoRows = await db.select().from(cargo).where(eq(cargo.playerId, pid));

  const ordersByEntity = new Map<string, QueueTask[]>();
  for (const q of queueRows) {
    const task: QueueTask = {
      entityId: q.entityId,
      slot: q.slot,
      action: q.actionType as QueueTask['action'],
      params: (q.params as QueueTask['params']) ?? null,
      costOvm: Number(q.costOvm),
      progressOvm: Number(q.progressOvm),
      status: q.status as QueueTask['status'],
      activatedAt: q.activatedAt?.toISOString() ?? null,
    };
    const list = ordersByEntity.get(q.entityId);
    if (list) list.push(task);
    else ordersByEntity.set(q.entityId, [task]);
  }

  const cargoByEntity = new Map<string, CargoItem[]>();
  for (const c of cargoRows) {
    const list = cargoByEntity.get(c.entityId);
    const item: CargoItem = { itemType: c.itemType, qty: c.qty };
    if (list) list.push(item);
    else cargoByEntity.set(c.entityId, [item]);
  }

  const eps = Math.max(1, cfg.game.coordEpsilon);
  // Поток получает первая по приоритету сущность с активным приказом
  const flowId = entityRows.find((e) => ordersByEntity.get(e.id)?.[0]?.status === 'active')?.id;

  const fleet: EntityState[] = entityRows.map((e) => {
    const orders = ordersByEntity.get(e.id) ?? [];
    const itemCargo = cargoByEntity.get(e.id) ?? [];
    const def = classOf(e);
    return {
      id: e.id,
      name: e.name,
      classId: e.classId as EntityClassId,
      status: statusOf(e, orders, e.id === flowId),
      sectorId: e.sectorId,
      x: e.x,
      y: e.y,
      dockedObjectId: e.dockedObjectId,
      modules: Array.isArray(e.modules) ? (e.modules as ModuleId[]) : [],
      groupKey: `${e.sectorId}|${Math.round(e.x / eps)}|${Math.round(e.y / eps)}`,
      priority: e.priority,
      hp: e.hp,
      hpMax: e.hpMax,
      cargoCapacity: def.cargoCapacity,
      cargoUsed: itemCargo.reduce((sum, c) => sum + c.qty, 0),
      cargo: itemCargo,
      orders,
    };
  });

  return { entities: fleet, ovmBuffer: Number(playerRow.ovmBuffer) };
}

/** Сколько единиц трюма занято у конкретной сущности. */
export async function cargoUsed(db: DbLike, entityId: string): Promise<number> {
  const rows = await db.select({ qty: cargo.qty }).from(cargo).where(eq(cargo.entityId, entityId));
  return rows.reduce((sum, r) => sum + r.qty, 0);
}
