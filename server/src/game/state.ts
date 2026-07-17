import type { CargoItem, QueueTask, StateResponse } from '@tokencontrol/shared';
import { asc, eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { cargo, players, queues, ships } from '../db/schema';
import type { ServerConfig } from './config';

/** И db, и транзакция — у обоих одинаковый query-интерфейс. */
export type DbLike = Db | Parameters<Parameters<Db['transaction']>[0]>[0];

export function r3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/** Снапшот состояния игрока для терминала; переиспользуется всеми маршрутами и WS. */
export async function buildState(
  db: DbLike,
  cfg: ServerConfig,
  pid: string,
): Promise<StateResponse | null> {
  const [shipRow] = await db.select().from(ships).where(eq(ships.playerId, pid));
  const [playerRow] = await db.select().from(players).where(eq(players.id, pid));
  if (!shipRow || !playerRow) return null;

  const queueRows = await db
    .select()
    .from(queues)
    .where(eq(queues.playerId, pid))
    .orderBy(asc(queues.slot));

  const cargoRows = await db.select().from(cargo).where(eq(cargo.playerId, pid));

  const queue: QueueTask[] = queueRows.map((q) => ({
    slot: q.slot as 1 | 2 | 3,
    action: q.actionType as QueueTask['action'],
    params: (q.params as QueueTask['params']) ?? null,
    costOvm: Number(q.costOvm),
    progressOvm: Number(q.progressOvm),
    status: q.status as QueueTask['status'],
  }));

  const cargoItems: CargoItem[] = cargoRows.map((c) => ({ itemType: c.itemType, qty: c.qty }));

  return {
    ship: {
      sectorId: shipRow.sectorId,
      x: shipRow.x,
      y: shipRow.y,
      dockedObjectId: shipRow.dockedObjectId,
    },
    queue,
    ovmBuffer: Number(playerRow.ovmBuffer),
    cargo: cargoItems,
    cargoCapacity: cfg.game.cargoCapacity,
  };
}

/** Сколько единиц трюма занято. */
export async function cargoUsed(db: DbLike, pid: string): Promise<number> {
  const rows = await db.select({ qty: cargo.qty }).from(cargo).where(eq(cargo.playerId, pid));
  return rows.reduce((sum, r) => sum + r.qty, 0);
}
