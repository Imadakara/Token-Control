import type { ActionParams, ActionType } from '@tokencontrol/shared';
import { and, asc, eq } from 'drizzle-orm';
import { actionLog, players, queues } from '../db/schema';
import { executeAction, validateAction, type ActionCtx } from './actions';
import { r3, type DbLike } from './state';

/**
 * Правила очереди (ТЗ п. 5): 3 слота, строго последовательное выполнение,
 * буфер ОВМ с капом, перенос излишка, «НЕВЫПОЛНИМО» с записью в журнал.
 * Дополнительно: исполнение набравшей стоимость задачи — не раньше, чем через
 * кулдаун (game.taskCooldownSec) после активации; довершает задачи серверный
 * свип (game/sweep.ts). Невыполнимая задача НЕ расходует ОВМ — накопленный
 * прогресс возвращается в каскад.
 * Все функции вызываются внутри транзакции с блокировкой строки игрока.
 */

export class QueueError extends Error {}

/** Событие завершения/пропуска — маршруты пушат его в WS после коммита. */
export interface QueueEvent {
  action: string;
  result: string;
}

type QueueRow = typeof queues.$inferSelect;

async function getQueue(db: DbLike, pid: string): Promise<QueueRow[]> {
  return db.select().from(queues).where(eq(queues.playerId, pid)).orderBy(asc(queues.slot));
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

function cooldownElapsed(ctx: ActionCtx, head: QueueRow): boolean {
  if (!head.activatedAt) return true;
  const cooldownMs = ctx.cfg.game.taskCooldownSec * 1000;
  return Date.now() - head.activatedAt.getTime() >= cooldownMs;
}

/**
 * Сдвигает задачи вверх без дыр и активирует слот 1 с валидацией.
 * Невыполнимые задачи пропускаются с записью в журнал; их прогресс (если был)
 * НЕ сгорает — его возвращает вызывающий каскад applyOvm.
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
        .set({ status: 'active', activatedAt: new Date() })
        .where(and(eq(queues.playerId, pid), eq(queues.slot, 1)));
      return;
    }
    // НЕВЫПОЛНИМО: пропуск; прогресс вернёт applyOvm (ТЗ-фикс: ОВМ не тратятся)
    await logAction(ctx, head.actionType, `НЕВЫПОЛНИМО: ${v.reason}`, { params: head.params });
    const refund = Number(head.progressOvm);
    await db.delete(queues).where(and(eq(queues.playerId, pid), eq(queues.slot, 1)));
    if (refund > 0) {
      // Возврат в буфер напрямую (вызов вне applyOvm — например, постановка)
      const buffer = await lockPlayer(db, pid);
      await setBuffer(db, pid, Math.min(ctx.cfg.game.ovmBufferCap, buffer + refund));
    }
  }
}

/**
 * Каскад начисления ОВМ. Алгоритм по шагам:
 * 1) голова невалидна → пропуск, её прогресс возвращается в каскад;
 * 2) голова набрала стоимость и кулдаун прошёл → исполнение, излишек дальше;
 * 3) голова набрала стоимость, кулдаун идёт → ждём свип (rest копится в ней);
 * 4) иначе — вливаем весь rest в счётчик головы (может превысить стоимость —
 *    излишек уйдёт дальше при исполнении).
 * Остаток при пустой очереди — в буфер с капом (переполнение игнорируется).
 */
export async function applyOvm(ctx: ActionCtx, ovm: number): Promise<void> {
  const { db, cfg, pid } = ctx;
  let rest = r3(ovm);

  for (;;) {
    const rows = await getQueue(db, pid);
    const head = rows[0];
    if (!head) break;

    if (head.status !== 'active') {
      await promoteQueue(ctx);
      const fresh = await getQueue(db, pid);
      if (!fresh[0] || fresh[0].status !== 'active') break;
      continue;
    }

    const action = head.actionType as ActionType;
    const params = head.params as ActionParams | null;

    // Условие могло сломаться после активации — проверяем до траты ОВМ
    const v = await validateAction(ctx, action, params, 'activate');
    if (!v.ok) {
      await logAction(ctx, action, `НЕВЫПОЛНИМО: ${v.reason}`, { params });
      rest = r3(rest + Number(head.progressOvm)); // ОВМ не расходуются
      await db.delete(queues).where(and(eq(queues.playerId, pid), eq(queues.slot, 1)));
      continue;
    }

    const progress = Number(head.progressOvm);
    const cost = Number(head.costOvm);

    if (progress >= cost) {
      if (!cooldownElapsed(ctx, head)) break; // исполнит свип после кулдауна
      const result = await executeAction(ctx, action, params);
      await logAction(ctx, action, result, { params });
      rest = r3(rest + (progress - cost)); // излишек — дальше по каскаду
      await db.delete(queues).where(and(eq(queues.playerId, pid), eq(queues.slot, 1)));
      continue;
    }

    if (rest <= 0) break;
    await db
      .update(queues)
      .set({ progressOvm: String(r3(progress + rest)) })
      .where(and(eq(queues.playerId, pid), eq(queues.slot, 1)));
    rest = 0;
  }

  if (rest > 0) {
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

  // Активация; заполненная задача исполнится свипом после кулдауна
  await applyOvm(ctx, 0);
}

export async function removeTask(ctx: ActionCtx, slot: 1 | 2 | 3): Promise<void> {
  const { db, pid } = ctx;
  await lockPlayer(db, pid);
  const rows = await getQueue(db, pid);
  const task = rows.find((t) => t.slot === slot);
  if (!task) throw new QueueError('СЛОТ ПУСТ');
  // Удаление игроком: накопленный прогресс сгорает (ТЗ п. 5)
  await db.delete(queues).where(and(eq(queues.playerId, pid), eq(queues.slot, slot)));
  await logAction(ctx, task.actionType, 'ЗАДАЧА УДАЛЕНА (ПРОГРЕСС СГОРЕЛ)', {
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
