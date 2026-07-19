import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import type { QueueEvent } from '../game/queue';
import { buildState } from '../game/state';

/**
 * Общие для всех маршрутов помощники пуша состояния в WS. Раньше жили в
 * routes/queue.ts; вынесены отдельно, когда queue.ts был удалён вместе с
 * экраном «Очередь» (фаза 8) — orders.ts, credits.ts, debug.ts и sweep.ts
 * используют их одинаково.
 */

export function pushQueueEvents(app: FastifyInstance, pid: string, events: QueueEvent[]): void {
  for (const e of events) {
    app.wsRegistry.push(pid, {
      type: 'journal',
      entry: {
        // Уникальный id обязателен: клиент рендерит журнал keyed-списком
        id: `ws-${randomUUID()}`,
        ts: new Date().toISOString(),
        action: e.action as never,
        result: e.result,
        details: null,
      },
    });
  }
}

/** Пушит журнал и свежий снапшот в WS и возвращает его же телом ответа. */
export async function respondWithState(
  app: FastifyInstance,
  pid: string,
  events: QueueEvent[] = [],
) {
  pushQueueEvents(app, pid, events);
  const state = (await buildState(app.db, app.cfg, pid))!;
  app.wsRegistry.push(pid, { type: 'state_delta', state });
  return state;
}
