import type { FastifyInstance } from 'fastify';
import type { CreditsSubmitRequest } from '@tokencontrol/shared';
import { submitCredits } from '../game/credits';
import { buildState } from '../game/state';

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

      const result = await submitCredits(app.db, app.cfg, req.user.pid, b);

      const state = await buildState(app.db, app.cfg, req.user.pid);
      if (state) app.wsRegistry.push(req.user.pid, { type: 'state_delta', state });

      return result;
    },
  );
}
