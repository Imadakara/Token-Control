import type { FastifyInstance } from 'fastify';
import type { KnowledgeResponse, TechResearchRequest, TechResponse } from '@tokencontrol/shared';
import { KNOWLEDGE_ENTRIES } from '@tokencontrol/shared';
import { listTechStatus, researchTech, unlockedEntryIds } from '../game/knowledge';
import { QueueError } from '../game/queue';
import { respondWithState } from './state-push';

/**
 * База Знаний и Технологии (ТЗ v0.02 пп. 5–6). Исследование технологии — не
 * приказ флоту, поэтому у него нет пары в orders.ts: это прямое действие
 * интерфейса управления, списывающее ОВМ мгновенно (game/knowledge.ts).
 */
export async function knowledgeRoutes(app: FastifyInstance) {
  /** Только реально открытые игроком записи (ТЗ п. 7: то же самое увидит ассистент). */
  app.get(
    '/knowledge',
    { preHandler: [app.authenticate] },
    async (req): Promise<KnowledgeResponse> => {
      const known = await unlockedEntryIds(app.db, req.user.pid);
      return { entries: KNOWLEDGE_ENTRIES.filter((e) => known.has(e.id)) };
    },
  );

  app.get('/tech', { preHandler: [app.authenticate] }, async (req): Promise<TechResponse> => {
    return { techs: await listTechStatus(app.db, req.user.pid) };
  });

  app.post<{ Body: TechResearchRequest }>(
    '/tech/research',
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const pid = req.user.pid;
      const techId = req.body?.techId;
      if (!techId) return reply.code(400).send({ error: 'НЕ УКАЗАНА ТЕХНОЛОГИЯ' });
      try {
        await app.db.transaction((tx) => researchTech(tx, pid, techId));
      } catch (err) {
        if (err instanceof QueueError) return reply.code(409).send({ error: err.message });
        throw err;
      }
      return respondWithState(app, pid);
    },
  );
}
