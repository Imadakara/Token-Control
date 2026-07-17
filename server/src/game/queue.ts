import type { ActionParams, ActionType } from '@tokencontrol/shared';
import { and, asc, eq } from 'drizzle-orm';
import { actionLog, players, queues } from '../db/schema';
import { executeAction, validateAction, type ActionCtx } from './actions';
import { r3, type DbLike } from './state';

/**
 * Правила очереди (ТЗ п. 5): 3 слота, строго последовательное выполнение,
 * буфер ОВМ с капом, перенос излишка, «НЕВЫПОЛНИМО» с записью в журнал.
 * Все функции вызываются внутри транзакции с блокировкой строки игрока.
 */

export class QueueError extends Error {}

type QueueRow = typeof queues.$inferSelect;

async function getQueue(db: DbLike, pid: string): Promise<QueueRow[]> {
  return db.select().from(queues).where(eq(queues.playerId, pid)).orderBy(asc(queues.slot));
}

export async function logAction(
  db: DbLike,
  pid: string,
  action: string,
  result: string,
  details: Record<string, unknown> | null = null,
): Promise<void> {
  await db.insert(actionLog).values({ playerId: pid, action, result, details });
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

async function completeHead(ctx: ActionCtx, head: QueueRow): Promise<void> {
  const { db, pid } = ctx;
  const action = head.actionType as ActionType;
  const params = head.params as ActionParams | null;
  // Повторная проверка условия непосредственно перед исполнением
  const v = await validateAction(ctx, action, params, 'activate');
  if (v.ok) {
    const result = await executeAction(ctx, action, params);
    await logAction(db, pid, action, result, { params });
  } else {
    await logAction(db, pid, action, `НЕВЫПОЛНИМО: ${v.reason}`, { params });
  }
  await db.delete(queues).where(and(eq(queues.playerId, pid), eq(queues.slot, head.slot)));
}

/**
 * Сдвигает задачи вверх без дыр и активирует слот 1 с валидацией.
 * Невыполнимые задачи пропускаются с записью в журнал (ТЗ п. 5).
 */
export async function promoteQueue(ctx: ActionCtx): Promise<void> {
  const { db, pid } = ctx;
  for (;;) {
    const rows = await getQueue(db, pid);
    // Уплотнение слотов: 1..n без дыр
    for (let i = 0; i < rows.length; i++) {
      const want = i + 1;
      if (rows[i]!.slot !== want) {
        await db
          .update(queues)
          .set({ slot: want })
          .where(and(eq(queues.playerId, pid), eq(queues.slot, rows[i]!.slot)));
      }
    }
    const fresh = await getQueue(db, pid);
    const head = fresh[0];
    if (!head) return;
    if (head.status === 'active') return;

    const v = await validateAction(
      ctx,
      head.actionType as ActionType,
      head.params as ActionParams | null,
      'activate',
    );
    if (v.ok) {
      await db
        .update(queues)
        .set({ status: 'active' })
        .where(and(eq(queues.playerId, pid), eq(queues.slot, 1)));
      return;
    }
    // НЕВЫПОЛНИМО: прогресс сгорает, задача пропускается
    await logAction(db, pid, head.actionType, `НЕВЫПОЛНИМО: ${v.reason}`, {
      params: head.params,
    });
    await db.delete(queues).where(and(eq(queues.playerId, pid), eq(queues.slot, 1)));
  }
}

/**
 * Вливает ОВМ в активную задачу. Заполненные задачи исполняются, излишек
 * каскадом идёт в следующую (ТЗ п. 5), при пустой очереди — в буфер с капом.
 */
export async function applyOvm(ctx: ActionCtx, ovm: number): Promise<void> {
  const { db, cfg, pid } = ctx;
  let rest = r3(ovm);

  await promoteQueue(ctx);

  for (;;) {
    const rows = await getQueue(db, pid);
    const head = rows[0];
    if (!head || head.status !== 'active') break;

    const need = r3(Number(head.costOvm) - Number(head.progressOvm));

    if (need <= 0) {
      // Счётчик уже полон (заполнен буфером при постановке)
      await completeHead(ctx, head);
      await promoteQueue(ctx);
      continue;
    }
    if (rest <= 0) break;

    if (rest < need) {
      await db
        .update(queues)
        .set({ progressOvm: String(r3(Number(head.progressOvm) + rest)) })
        .where(and(eq(queues.playerId, pid), eq(queues.slot, 1)));
      rest = 0;
      break;
    }

    rest = r3(rest - need);
    await completeHead(ctx, head);
    await promoteQueue(ctx);
  }

  if (rest > 0) {
    // Очередь пуста — излишек в буфер с капом; переполнение игнорируется (ТЗ п. 5)
    const buffer = await lockPlayer(db, pid);
    await setBuffer(db, pid, Math.min(cfg.game.ovmBufferCap, buffer + rest));
  }
}

export async function addTask(
  ctx: ActionCtx,
  action: ActionType,
  params: ActionParams | null,
): Promise<void> {
  const { db, cfg, pid } = ctx;
  const buffer = await lockPlayer(db, pid);

  const rows = await getQueue(db, pid);
  if (rows.length >= 3) throw new QueueError('ОЧЕРЕДЬ ЗАПОЛНЕНА');

  // Валидация на постановке (ТЗ п. 5): только статические условия
  const v = await validateAction(ctx, action, params, 'enqueue');
  if (!v.ok) throw new QueueError(v.reason);

  const cost = cfg.game.actionCosts[action];
  // ОВМ из буфера «вливаются» в счётчик новой задачи (ТЗ п. 5)
  const prefill = Math.min(buffer, cost);
  await db.insert(queues).values({
    playerId: pid,
    slot: rows.length + 1,
    actionType: action,
    params,
    costOvm: String(cost),
    progressOvm: String(r3(prefill)),
    status: 'waiting',
  });
  if (prefill > 0) await setBuffer(db, pid, buffer - prefill);

  // Активация; если буфер целиком закрыл стоимость — исполнится сразу
  await applyOvm(ctx, 0);
}

export async function removeTask(ctx: ActionCtx, slot: 1 | 2 | 3): Promise<void> {
  const { db, pid } = ctx;
  await lockPlayer(db, pid);
  const rows = await getQueue(db, pid);
  const task = rows.find((t) => t.slot === slot);
  if (!task) throw new QueueError('СЛОТ ПУСТ');
  // Накопленный прогресс сгорает (ТЗ п. 5); подтверждение — на клиенте
  await db.delete(queues).where(and(eq(queues.playerId, pid), eq(queues.slot, slot)));
  await logAction(db, pid, task.actionType, 'ЗАДАЧА УДАЛЕНА (ПРОГРЕСС СГОРЕЛ)', {
    progress: Number(task.progressOvm),
  });
  await applyOvm(ctx, 0);
}

export async function reorderTasks(ctx: ActionCtx, from: 2 | 3, to: 2 | 3): Promise<void> {
  const { db, pid } = ctx;
  await lockPlayer(db, pid);
  if (from === to) return;
  const rows = await getQueue(db, pid);
  const a = rows.find((t) => t.slot === from);
  const b = rows.find((t) => t.slot === to);
  if (!a || !b) throw new QueueError('НЕЧЕГО ПЕРЕСТАВЛЯТЬ');
  // Обмен через временный слот (PK player_id+slot)
  await db.update(queues).set({ slot: 99 }).where(and(eq(queues.playerId, pid), eq(queues.slot, from)));
  await db.update(queues).set({ slot: from }).where(and(eq(queues.playerId, pid), eq(queues.slot, to)));
  await db.update(queues).set({ slot: to }).where(and(eq(queues.playerId, pid), eq(queues.slot, 99)));
}
