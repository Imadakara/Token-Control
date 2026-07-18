import type { FastifyInstance } from 'fastify';
import type {
  QueueAddRequest,
  QueueRemoveRequest,
  QueueReorderRequest,
  StateResponse,
} from '@tokencontrol/shared';
import { ACTION_TYPES } from '@tokencontrol/shared';
import { eq } from 'drizzle-orm';
import { ships } from '../db/schema';
import { addTask, QueueError, removeTask, reorderTasks, type QueueEvent } from '../game/queue';
import { buildState } from '../game/state';

export function pushQueueEvents(
  app: FastifyInstance,
  pid: string,
  events: QueueEvent[],
): void {
  for (const e of events) {
    app.wsRegistry.push(pid, {
      type: 'journal',
      entry: {
        id: '0',
        ts: new Date().toISOString(),
        action: e.action as never,
        result: e.result,
        details: null,
      },
    });
  }
}

export async function queueRoutes(app: FastifyInstance) {
  const respondWithState = async (pid: string, events: QueueEvent[] = []): Promise<StateResponse> => {
    pushQueueEvents(app, pid, events);
    const state = (await buildState(app.db, app.cfg, pid))!;
    app.wsRegistry.push(pid, { type: 'state_delta', state });
    return state;
  };

  const handleQueueError = (err: unknown, reply: { code: (n: number) => { send: (b: unknown) => unknown } }) => {
    if (err instanceof QueueError) return reply.code(409).send({ error: err.message });
    throw err;
  };

  app.post<{ Body: QueueAddRequest }>(
    '/queue/add',
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const { action, params } = req.body ?? {};
      if (!ACTION_TYPES.includes(action)) {
        return reply.code(400).send({ error: 'НЕИЗВЕСТНОЕ ДЕЙСТВИЕ' });
      }
      const events: QueueEvent[] = [];
      try {
        await app.db.transaction(async (tx) => {
          await addTask({ db: tx, cfg: app.cfg, pid: req.user.pid, events }, action, params ?? null);
        });
      } catch (err) {
        return handleQueueError(err, reply);
      }
      return respondWithState(req.user.pid, events);
    },
  );

  app.post<{ Body: QueueRemoveRequest }>(
    '/queue/remove',
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const slot = req.body?.slot;
      if (slot !== 1 && slot !== 2 && slot !== 3) {
        return reply.code(400).send({ error: 'СЛОТ: 1..3' });
      }
      const events: QueueEvent[] = [];
      try {
        await app.db.transaction(async (tx) => {
          await removeTask({ db: tx, cfg: app.cfg, pid: req.user.pid, events }, slot);
        });
      } catch (err) {
        return handleQueueError(err, reply);
      }
      return respondWithState(req.user.pid, events);
    },
  );

  app.post<{ Body: QueueReorderRequest }>(
    '/queue/reorder',
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const { from, to } = req.body ?? {};
      // Переставлять можно только слоты ожидания (ТЗ п. 5)
      if ((from !== 2 && from !== 3) || (to !== 2 && to !== 3)) {
        return reply.code(400).send({ error: 'ПЕРЕСТАНОВКА: СЛОТЫ 2-3' });
      }
      try {
        await app.db.transaction(async (tx) => {
          await reorderTasks({ db: tx, cfg: app.cfg, pid: req.user.pid }, from, to);
        });
      } catch (err) {
        return handleQueueError(err, reply);
      }
      return respondWithState(req.user.pid);
    },
  );

  /** Расстыковка — мгновенно и без стоимости (ТЗ п. 6.4). */
  app.post('/ship/undock', { preHandler: [app.authenticate] }, async (req) => {
    const pid = req.user.pid;
    await app.db.update(ships).set({ dockedObjectId: null }).where(eq(ships.playerId, pid));
    return respondWithState(pid);
  });
}
