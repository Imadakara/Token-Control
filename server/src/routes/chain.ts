import type { FastifyInstance } from 'fastify';
import type { ChainConnectRequest, ChainResponse } from '@tokencontrol/shared';
import { connectChainKey, playerChainKeys } from '../game/chain';
import { QueueError } from '../game/queue';
import { respondWithState } from './state-push';

/**
 * Цепь Миров (ТЗ v0.02 п. 4). Постройка врат — обычный приказ флоту
 * (game/actions.ts: build_gate), поэтому пары-роута у неё здесь нет; этот
 * файл — только заглушка магазина ключей и их применение.
 */
export async function chainRoutes(app: FastifyInstance) {
  app.get('/chain', { preHandler: [app.authenticate] }, async (req): Promise<ChainResponse> => {
    const rows = await playerChainKeys(app.db, req.user.pid);
    return {
      keys: rows.map((k) => ({
        id: k.id,
        targetSectorId: k.targetSectorId,
        source: k.source,
        consumedAt: k.consumedAt?.toISOString() ?? null,
      })),
    };
  });

  /**
   * Точка монетизации (ТЗ п. 4): реальная продажа ключей — Steam, фаза 99.
   * Здесь только применение уже выданного ключа.
   */
  app.post<{ Body: ChainConnectRequest }>(
    '/chain/connect',
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const pid = req.user.pid;
      const keyId = req.body?.keyId;
      if (!keyId) return reply.code(400).send({ error: 'НЕ УКАЗАН КЛЮЧ' });
      try {
        await app.db.transaction((tx) => connectChainKey(tx, pid, keyId));
      } catch (err) {
        if (err instanceof QueueError) return reply.code(409).send({ error: err.message });
        throw err;
      }
      return respondWithState(app, pid);
    },
  );
}
