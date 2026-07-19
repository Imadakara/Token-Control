import type { ActionParams, ActionType } from '@tokencontrol/shared';
import { and, asc, eq } from 'drizzle-orm';
import { actionLog, players, queues } from '../db/schema';
import { executeAction, validateAction, type ActionCtx } from './actions';
import { getEntity, listEntities, type EntityRow } from './entities';
import { r3, type DbLike } from './state';

/**
 * Правила очереди приказов (ТЗ п. 5, ТЗ v0.02 п. 3): до GameConfig.orderSlots
 * слотов НА СУЩНОСТЬ, строго последовательное выполнение внутри сущности,
 * общий на игрока буфер ОВМ с капом, перенос излишка, «НЕВЫПОЛНИМО» с записью
 * в журнал.
 *
 * Раздача общего потока ОВМ между сущностями — строго по приоритету
 * (priority, id): ОВМ льётся в голову очереди первой сущности, излишек
 * завершённого приказа каскадом уходит следующей, остаток — в буфер.
 * При одной сущности поведение совпадает с однокорабельным MVP.
 *
 * Все функции вызываются внутри транзакции с блокировкой строки игрока
 * (lockPlayer) — она остаётся единственной точкой сериализации, поэтому
 * порядка блокировок между сущностями не возникает.
 */

export class QueueError extends Error {}

/** Событие завершения/пропуска — маршруты пушат его в WS после коммита. */
export interface QueueEvent {
  action: string;
  result: string;
}

type QueueRow = typeof queues.$inferSelect;

async function getQueue(db: DbLike, entityId: string): Promise<QueueRow[]> {
  return db.select().from(queues).where(eq(queues.entityId, entityId)).orderBy(asc(queues.slot));
}

export async function logAction(
  ctx: ActionCtx,
  action: string,
  result: string,
  details: Record<string, unknown> | null = null,
): Promise<void> {
  await ctx.db.insert(actionLog).values({ playerId: ctx.pid, action, result, details });
  ctx.events?.push({ action, result });
}

/** Блокирует строку игрока на время транзакции (сериализация начислений). */
export async function lockPlayer(db: DbLike, pid: string): Promise<number> {
  const [row] = await db
    .select({ ovmBuffer: players.ovmBuffer })
    .from(players)
    .where(eq(players.id, pid))
    .for('update');
  if (!row) throw new QueueError('ИГРОК НЕ НАЙДЕН');
  return Number(row.ovmBuffer);
}

async function setBuffer(db: DbLike, pid: string, value: number): Promise<void> {
  await db
    .update(players)
    .set({ ovmBuffer: String(r3(value)) })
    .where(eq(players.id, pid));
}

async function addToBuffer(ctx: ActionCtx, amount: number): Promise<void> {
  const buffer = await lockPlayer(ctx.db, ctx.pid);
  await setBuffer(ctx.db, ctx.pid, Math.min(ctx.cfg.game.ovmBufferCap, buffer + amount));
}

function cooldownElapsed(ctx: ActionCtx, head: QueueRow): boolean {
  if (!head.activatedAt) return true;
  const cooldownMs = ctx.cfg.game.taskCooldownSec * 1000;
  return Date.now() - head.activatedAt.getTime() >= cooldownMs;
}

/**
 * Сдвигает приказы сущности вверх без дыр и активирует слот 1 с валидацией.
 * Невыполнимые приказы пропускаются с записью в журнал; их прогресс (если был)
 * НЕ сгорает — возвращается в буфер.
 */
export async function promoteQueue(ctx: ActionCtx, entity: EntityRow): Promise<void> {
  const { db } = ctx;
  for (;;) {
    const rows = await getQueue(db, entity.id);
    // Уплотнение слотов: 1..n без дыр
    for (let i = 0; i < rows.length; i++) {
      const want = i + 1;
      if (rows[i]!.slot !== want) {
        await db
          .update(queues)
          .set({ slot: want })
          .where(and(eq(queues.entityId, entity.id), eq(queues.slot, rows[i]!.slot)));
      }
    }
    const fresh = await getQueue(db, entity.id);
    const head = fresh[0];
    if (!head) return;
    if (head.status === 'active') return;

    const v = await validateAction(
      ctx,
      entity,
      head.actionType as ActionType,
      head.params as ActionParams | null,
      'activate',
    );
    if (v.ok) {
      await db
        .update(queues)
        .set({ status: 'active', activatedAt: new Date() })
        .where(and(eq(queues.entityId, entity.id), eq(queues.slot, 1)));
      return;
    }
    // НЕВЫПОЛНИМО: пропуск; ОВМ не расходуются — прогресс возвращается
    await logAction(ctx, head.actionType, `НЕВЫПОЛНИМО: ${v.reason}`, {
      entityId: entity.id,
      params: head.params,
    });
    const refund = Number(head.progressOvm);
    await db.delete(queues).where(and(eq(queues.entityId, entity.id), eq(queues.slot, 1)));
    if (refund > 0) await addToBuffer(ctx, refund);
  }
}

/**
 * Прокачивает очередь ОДНОЙ сущности, потребляя `rest`. Возвращает остаток и
 * признак того, что был исполнен хотя бы один приказ.
 *
 * Отличие от однокорабельного MVP: сущность, чья голова набрала стоимость, но
 * стоит в кулдауне, не обрывает каскад, а пропускается — иначе один кулдаун
 * морозил бы весь флот. Её приказ довершит свип.
 */
async function pumpEntityQueue(
  ctx: ActionCtx,
  entityId: string,
  incoming: number,
): Promise<{ rest: number; executed: boolean }> {
  const { db } = ctx;
  let rest = incoming;
  let executed = false;

  for (;;) {
    // Сущность перечитывается каждую итерацию: прыжок/стыковка меняют её строку,
    // а следующий приказ валидируется уже по новому положению.
    const entity = await getEntity(db, entityId);
    if (!entity) break;

    const rows = await getQueue(db, entityId);
    const head = rows[0];
    if (!head) break;

    if (head.status !== 'active') {
      await promoteQueue(ctx, entity);
      const fresh = await getQueue(db, entityId);
      if (!fresh[0] || fresh[0].status !== 'active') break;
      continue;
    }

    const action = head.actionType as ActionType;
    const params = head.params as ActionParams | null;

    // Условие могло сломаться после активации — проверяем до траты ОВМ
    const v = await validateAction(ctx, entity, action, params, 'activate');
    if (!v.ok) {
      await logAction(ctx, action, `НЕВЫПОЛНИМО: ${v.reason}`, { entityId, params });
      rest = r3(rest + Number(head.progressOvm)); // ОВМ не расходуются
      await db.delete(queues).where(and(eq(queues.entityId, entityId), eq(queues.slot, 1)));
      continue;
    }

    const progress = Number(head.progressOvm);
    const cost = Number(head.costOvm);

    if (progress >= cost) {
      if (!cooldownElapsed(ctx, head)) break; // исполнит свип; поток идёт дальше
      const result = await executeAction(ctx, entity, action, params);
      await logAction(ctx, action, result, { entityId, params });
      rest = r3(rest + (progress - cost)); // излишек — дальше по каскаду
      await db.delete(queues).where(and(eq(queues.entityId, entityId), eq(queues.slot, 1)));
      executed = true;
      continue;
    }

    if (rest <= 0) break;
    await db
      .update(queues)
      .set({ progressOvm: String(r3(progress + rest)) })
      .where(and(eq(queues.entityId, entityId), eq(queues.slot, 1)));
    rest = 0;
  }

  return { rest, executed };
}

/**
 * Каскад начисления ОВМ по всему флоту. Сущности обходятся по приоритету;
 * остаток после каждой перетекает к следующей, финальный остаток — в буфер
 * с капом (переполнение игнорируется).
 *
 * Повторный проход нужен, когда исполнение приказа освободило слот у сущности,
 * которую поток уже миновал; счётчик проходов ограничен, чтобы каскад не мог
 * зациклиться на неожиданных данных.
 */
export async function applyOvm(ctx: ActionCtx, ovm: number): Promise<void> {
  let rest = r3(ovm);

  const fleet = await listEntities(ctx.db, ctx.pid);
  const maxPasses = fleet.length + 2;

  for (let pass = 0; pass < maxPasses; pass++) {
    let executedAny = false;
    for (const entity of fleet) {
      const r = await pumpEntityQueue(ctx, entity.id, rest);
      rest = r.rest;
      executedAny ||= r.executed;
    }
    if (!executedAny || rest <= 0) break;
  }

  if (rest > 0) await addToBuffer(ctx, rest);
}

export async function addTask(
  ctx: ActionCtx,
  entity: EntityRow,
  action: ActionType,
  params: ActionParams | null,
): Promise<void> {
  const { db, cfg, pid } = ctx;
  const buffer = await lockPlayer(db, pid);

  const rows = await getQueue(db, entity.id);
  if (rows.length >= cfg.game.orderSlots) throw new QueueError('ОЧЕРЕДЬ ЗАПОЛНЕНА');

  // Валидация на постановке (ТЗ п. 5): только статические условия
  const v = await validateAction(ctx, entity, action, params, 'enqueue');
  if (!v.ok) throw new QueueError(v.reason);

  const cost = cfg.game.actionCosts[action];
  // ОВМ из буфера «вливаются» в счётчик нового приказа (ТЗ п. 5)
  const prefill = Math.min(buffer, cost);
  await db.insert(queues).values({
    entityId: entity.id,
    playerId: pid,
    slot: rows.length + 1,
    actionType: action,
    params,
    costOvm: String(cost),
    progressOvm: String(r3(prefill)),
    status: 'waiting',
  });
  if (prefill > 0) await setBuffer(db, pid, buffer - prefill);

  // Активация; заполненный приказ исполнится свипом после кулдауна
  await applyOvm(ctx, 0);
}

export async function removeTask(
  ctx: ActionCtx,
  entity: EntityRow,
  slot: number,
): Promise<void> {
  const { db } = ctx;
  await lockPlayer(db, ctx.pid);
  const rows = await getQueue(db, entity.id);
  const task = rows.find((t) => t.slot === slot);
  if (!task) throw new QueueError('СЛОТ ПУСТ');
  // Удаление игроком: накопленный прогресс сгорает (ТЗ п. 5)
  await db.delete(queues).where(and(eq(queues.entityId, entity.id), eq(queues.slot, slot)));
  await logAction(ctx, task.actionType, 'ПРИКАЗ ОТМЕНЁН (ПРОГРЕСС СГОРЕЛ)', {
    entityId: entity.id,
    progress: Number(task.progressOvm),
  });
  await applyOvm(ctx, 0);
}

export async function reorderTasks(
  ctx: ActionCtx,
  entity: EntityRow,
  from: number,
  to: number,
): Promise<void> {
  const { db } = ctx;
  await lockPlayer(db, ctx.pid);
  if (from === to) return;
  const rows = await getQueue(db, entity.id);
  const a = rows.find((t) => t.slot === from);
  const b = rows.find((t) => t.slot === to);
  if (!a || !b) throw new QueueError('НЕЧЕГО ПЕРЕСТАВЛЯТЬ');
  // Обмен через временный слот (PK entity_id+slot)
  const tmp = 99;
  await db
    .update(queues)
    .set({ slot: tmp })
    .where(and(eq(queues.entityId, entity.id), eq(queues.slot, from)));
  await db
    .update(queues)
    .set({ slot: from })
    .where(and(eq(queues.entityId, entity.id), eq(queues.slot, to)));
  await db
    .update(queues)
    .set({ slot: to })
    .where(and(eq(queues.entityId, entity.id), eq(queues.slot, tmp)));
}
