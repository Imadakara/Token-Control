import type { FastifyInstance } from 'fastify';
import type {
  FleetPriorityRequest,
  FleetRenameRequest,
  OrdersAddRequest,
  OrdersAddResponse,
  OrdersAvailableResponse,
  OrdersRemoveRequest,
  OrdersReorderRequest,
} from '@tokencontrol/shared';
import { ACTION_TYPES } from '@tokencontrol/shared';
import { and, eq } from 'drizzle-orm';
import { entities } from '../db/schema';
import { getOwnedEntity, listEntities } from '../game/entities';
import { listOrders } from '../game/orders';
import { addTask, QueueError, removeTask, reorderTasks, type QueueEvent } from '../game/queue';
import { respondWithState } from './state-push';

/**
 * Приказы сущностям флота (ТЗ v0.02 п. 3) и управление самим флотом.
 * Групповой приказ — веерная рассылка на этапе постановки: каждая сущность
 * валидируется независимо и получает копию приказа в собственную очередь.
 */
export async function orderRoutes(app: FastifyInstance) {
  const badSlot = (slot: unknown): boolean =>
    typeof slot !== 'number' || !Number.isInteger(slot) || slot < 1 || slot > app.cfg.game.orderSlots;

  /**
   * Что сущность может сделать прямо сейчас (ТЗ v0.02 п. 3.1) — отдельным
   * эндпоинтом, а не полем в /state: список стоит O(сущности × приказы ×
   * объекты рядом), а state_delta пушится по WS на каждый тик начисления ОВМ,
   * раздувать самое горячее сообщение такими данными нельзя. Клиент запрашивает
   * это по факту открытия дерева приказов / окна выбора и кэширует по entityId.
   */
  app.get<{ Querystring: { entityId?: string } }>(
    '/orders/available',
    { preHandler: [app.authenticate] },
    async (req, reply): Promise<OrdersAvailableResponse> => {
      const pid = req.user.pid;
      const targetId = req.query.entityId;
      let fleet;
      if (targetId) {
        const one = await getOwnedEntity(app.db, pid, targetId);
        if (!one) return reply.code(404).send({ error: 'СУЩНОСТЬ НЕ НАЙДЕНА' });
        fleet = [one];
      } else {
        fleet = await listEntities(app.db, pid);
      }
      const result = await Promise.all(
        fleet.map(async (entity) => ({
          entityId: entity.id,
          orders: await listOrders({ db: app.db, cfg: app.cfg, pid }, entity),
        })),
      );
      return { entities: result };
    },
  );

  app.post<{ Body: OrdersAddRequest }>(
    '/orders/add',
    { preHandler: [app.authenticate] },
    async (req, reply): Promise<OrdersAddResponse | unknown> => {
      const pid = req.user.pid;
      const { entityIds, action, params } = req.body ?? {};
      if (!ACTION_TYPES.includes(action)) {
        return reply.code(400).send({ error: 'НЕИЗВЕСТНЫЙ ПРИКАЗ' });
      }
      if (!Array.isArray(entityIds) || entityIds.length === 0) {
        return reply.code(400).send({ error: 'НЕ УКАЗАНЫ СУЩНОСТИ' });
      }

      const events: QueueEvent[] = [];
      const results: OrdersAddResponse['results'] = [];

      // Каждая сущность — своя транзакция: отказ одной не отменяет остальных
      for (const entityId of entityIds) {
        try {
          await app.db.transaction(async (tx) => {
            const entity = await getOwnedEntity(tx, pid, entityId);
            if (!entity) throw new QueueError('СУЩНОСТЬ НЕ НАЙДЕНА');
            await addTask({ db: tx, cfg: app.cfg, pid, events }, entity, action, params ?? null);
          });
          results.push({ entityId, ok: true });
        } catch (err) {
          if (err instanceof QueueError) results.push({ entityId, ok: false, reason: err.message });
          else throw err;
        }
      }

      const state = await respondWithState(app, pid, events);
      return { results, state };
    },
  );

  app.post<{ Body: OrdersRemoveRequest }>(
    '/orders/remove',
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const pid = req.user.pid;
      const { entityId, slot } = req.body ?? {};
      if (badSlot(slot)) {
        return reply.code(400).send({ error: `СЛОТ: 1..${app.cfg.game.orderSlots}` });
      }
      const events: QueueEvent[] = [];
      try {
        await app.db.transaction(async (tx) => {
          const entity = await getOwnedEntity(tx, pid, entityId);
          if (!entity) throw new QueueError('СУЩНОСТЬ НЕ НАЙДЕНА');
          await removeTask({ db: tx, cfg: app.cfg, pid, events }, entity, slot);
        });
      } catch (err) {
        if (err instanceof QueueError) return reply.code(409).send({ error: err.message });
        throw err;
      }
      return respondWithState(app, pid, events);
    },
  );

  app.post<{ Body: OrdersReorderRequest }>(
    '/orders/reorder',
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const pid = req.user.pid;
      const { entityId, from, to } = req.body ?? {};
      // Переставлять можно только слоты ожидания: слот 1 уже исполняется
      if (badSlot(from) || badSlot(to) || from < 2 || to < 2) {
        return reply.code(400).send({ error: `ПЕРЕСТАНОВКА: СЛОТЫ 2..${app.cfg.game.orderSlots}` });
      }
      try {
        await app.db.transaction(async (tx) => {
          const entity = await getOwnedEntity(tx, pid, entityId);
          if (!entity) throw new QueueError('СУЩНОСТЬ НЕ НАЙДЕНА');
          await reorderTasks({ db: tx, cfg: app.cfg, pid }, entity, from, to);
        });
      } catch (err) {
        if (err instanceof QueueError) return reply.code(409).send({ error: err.message });
        throw err;
      }
      return respondWithState(app, pid);
    },
  );

  /** Порядок раздачи общего потока ОВМ (ТЗ v0.02 п. 3). */
  app.post<{ Body: FleetPriorityRequest }>(
    '/fleet/priority',
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const pid = req.user.pid;
      const ids = req.body?.entityIds;
      if (!Array.isArray(ids) || ids.length === 0) {
        return reply.code(400).send({ error: 'НЕ УКАЗАН ПОРЯДОК' });
      }
      const owned = new Set((await listEntities(app.db, pid)).map((e) => e.id));
      if (ids.some((id) => !owned.has(id))) {
        return reply.code(400).send({ error: 'ЧУЖАЯ СУЩНОСТЬ В СПИСКЕ' });
      }
      await app.db.transaction(async (tx) => {
        for (let i = 0; i < ids.length; i++) {
          await tx
            .update(entities)
            .set({ priority: i + 1 })
            .where(and(eq(entities.id, ids[i]!), eq(entities.playerId, pid)));
        }
      });
      return respondWithState(app, pid);
    },
  );

  app.post<{ Body: FleetRenameRequest }>(
    '/fleet/rename',
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const pid = req.user.pid;
      const { entityId, name } = req.body ?? {};
      const trimmed = name?.trim();
      if (!trimmed || trimmed.length > 32) {
        return reply.code(400).send({ error: 'ИМЯ: 1-32 СИМВОЛА' });
      }
      const entity = await getOwnedEntity(app.db, pid, entityId);
      if (!entity) return reply.code(404).send({ error: 'СУЩНОСТЬ НЕ НАЙДЕНА' });
      await app.db.update(entities).set({ name: trimmed }).where(eq(entities.id, entity.id));
      return respondWithState(app, pid);
    },
  );
}
