import type { FastifyInstance } from 'fastify';
import { and, eq, lte, sql } from 'drizzle-orm';
import { queues } from '../db/schema';
import { pushQueueEvents } from '../routes/state-push';
import type { QueueEvent } from './queue';
import { applyOvm, lockPlayer } from './queue';
import { buildState } from './state';

/**
 * Свип исполнения: задачи, набравшие стоимость и отстоявшие кулдаун,
 * довершаются здесь (applyOvm сам исполняет и продвигает каскад).
 * Вызывается таймером раз в секунду (index.ts).
 */
export async function sweepQueueCompletions(app: FastifyInstance): Promise<void> {
  const cooldownMs = app.cfg.game.taskCooldownSec * 1000;
  // Приказы ведутся по сущностям, но начисления сериализуются по игроку:
  // берём игроков, у кого хоть одна сущность готова исполнить приказ.
  const due = await app.db
    .selectDistinct({ playerId: queues.playerId })
    .from(queues)
    .where(
      and(
        eq(queues.slot, 1),
        eq(queues.status, 'active'),
        sql`${queues.progressOvm} >= ${queues.costOvm}`,
        lte(queues.activatedAt, new Date(Date.now() - cooldownMs)),
      ),
    );

  for (const { playerId } of due) {
    const events: QueueEvent[] = [];
    try {
      await app.db.transaction(async (tx) => {
        await lockPlayer(tx, playerId);
        await applyOvm({ db: tx, cfg: app.cfg, pid: playerId, events }, 0);
      });
    } catch (err) {
      app.log.error(err, `sweep failed for ${playerId}`);
      continue;
    }
    if (events.length > 0) {
      pushQueueEvents(app, playerId, events);
      const state = await buildState(app.db, app.cfg, playerId);
      if (state) app.wsRegistry.push(playerId, { type: 'state_delta', state });
    }
  }
}

export function startSweepTimer(app: FastifyInstance, intervalMs = 1000): NodeJS.Timeout {
  const timer = setInterval(() => {
    sweepQueueCompletions(app).catch((err) => app.log.error(err, 'sweep tick failed'));
  }, intervalMs);
  timer.unref();
  return timer;
}
