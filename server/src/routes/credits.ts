import type { FastifyInstance } from 'fastify';
import type { CreditsSubmitRequest } from '@tokencontrol/shared';
import { submitCredits } from '../game/credits';
import type { QueueEvent } from '../game/queue';
import { buildState } from '../game/state';
import { pushQueueEvents } from './state-push';

export async function creditsRoutes(app: FastifyInstance) {
  /** Пакеты начислений от коннектора (ТЗ п. 7.4); идемпотентно по packetSeq. */
  app.post<{ Body: CreditsSubmitRequest }>(
    '/credits/submit',
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const b = req.body;
      if (
        !b ||
        !Number.isFinite(b.packetSeq) ||
        b.packetSeq < 0 ||
        !Number.isFinite(b.ovm) ||
        !b.tokens ||
        !b.intervalStart ||
        !b.intervalEnd
      ) {
        return reply.code(400).send({ error: 'НЕКОРРЕКТНЫЙ ПАКЕТ' });
      }

      const events: QueueEvent[] = [];
      const result = await submitCredits(app.db, app.cfg, req.user.pid, b, events);

      pushQueueEvents(app, req.user.pid, events);
      const state = await buildState(app.db, app.cfg, req.user.pid);
      if (state) app.wsRegistry.push(req.user.pid, { type: 'state_delta', state });

      return result;
    },
  );
}
