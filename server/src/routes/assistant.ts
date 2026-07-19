import type { FastifyInstance } from 'fastify';
import { prepareAssistantContext } from '../game/assistant';
import { buildState } from '../game/state';
import { QueueError } from '../game/queue';

/**
 * ИИ-ассистент (ТЗ v0.02 п. 7): единственный серверный эндпоинт — списание
 * ОВМ и выдача контекста (см. game/assistant.ts). Сам разговор с моделью и
 * исполнение её команд — целиком на клиенте, через штатные REST-эндпоинты.
 */
export async function assistantRoutes(app: FastifyInstance) {
  app.post(
    '/assistant/prepare',
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const pid = req.user.pid;
      try {
        const result = await app.db.transaction((tx) =>
          prepareAssistantContext(tx, pid, app.cfg.game.assistantCostOvm),
        );
        // Тело ответа — не StateResponse (в отличие от respondWithState), но
        // буфер всё равно изменился — пушим свежий снапшот, чтобы другие
        // панели (Статус, Флотилия) не показывали стухшее число до опроса.
        const state = (await buildState(app.db, app.cfg, pid))!;
        app.wsRegistry.push(pid, { type: 'state_delta', state });
        return result;
      } catch (err) {
        if (err instanceof QueueError) return reply.code(409).send({ error: err.message });
        throw err;
      }
    },
  );
}
