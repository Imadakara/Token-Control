import type { FastifyInstance } from 'fastify';
import type { StateResponse } from '@tokencontrol/shared';
import { buildState } from '../game/state';

export async function stateRoutes(app: FastifyInstance) {
  /** Снапшот для терминала (ТЗ п. 8: API state). */
  app.get(
    '/state',
    { preHandler: [app.authenticate] },
    async (req, reply): Promise<StateResponse> => {
      const state = await buildState(app.db, app.cfg, req.user.pid);
      if (!state) return reply.code(404).send({ error: 'player not found' });
      return state;
    },
  );
}
