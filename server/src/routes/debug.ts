import type { FastifyInstance } from 'fastify';
import type { EntityClassId } from '@tokencontrol/shared';
import { isEntityClassId } from '@tokencontrol/shared';
import { eq, sql } from 'drizzle-orm';
import { chainKeys, players } from '../db/schema';
import { createEntity, leadEntity } from '../game/entities';
import { lockPlayer } from '../game/queue';
import { buildState, r3 } from '../game/state';
import { respondWithState } from './state-push';

/** Игрок, которому доступны отладочные команды (вход с позывным DEBUG). */
const DEBUG_PID = 'dev:DEBUG';

export async function debugRoutes(app: FastifyInstance) {
  /** Дебаг: начисление ОВМ прямо в буфер, мимо коннектора/лимитов/леджера. */
  app.post<{ Body: { ovm?: number } }>(
    '/debug/credit',
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const pid = req.user.pid;
      if (pid !== DEBUG_PID) {
        return reply.code(403).send({ error: 'ТОЛЬКО ДЛЯ КАПИТАНА DEBUG' });
      }
      const ovm = r3(Math.min(100_000, Math.max(0, Number(req.body?.ovm ?? 1000))));

      await app.db.transaction(async (tx) => {
        await lockPlayer(tx, pid);
        const cap = app.cfg.game.ovmBufferCap;
        await tx
          .update(players)
          .set({ ovmBuffer: sql`LEAST(${cap}::numeric, ${players.ovmBuffer} + ${ovm})` })
          .where(eq(players.id, pid));
      });

      const state = (await buildState(app.db, app.cfg, pid))!;
      app.wsRegistry.push(pid, { type: 'state_delta', state });
      return state;
    },
  );

  /** Дебаг: пополнение флота — до появления производства (roadmap ТЗ п. 81). */
  app.post<{ Body: { classId?: string } }>(
    '/debug/spawn',
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const pid = req.user.pid;
      if (pid !== DEBUG_PID) {
        return reply.code(403).send({ error: 'ТОЛЬКО ДЛЯ КАПИТАНА DEBUG' });
      }
      const raw = req.body?.classId ?? 'scout_mk1';
      if (!isEntityClassId(raw)) return reply.code(400).send({ error: 'НЕИЗВЕСТНЫЙ КЛАСС' });
      const classId: EntityClassId = raw;

      const lead = await leadEntity(app.db, pid);
      if (!lead) return reply.code(404).send({ error: 'НЕТ СУЩНОСТЕЙ' });
      // Рядом с ведущей сущностью — в тех же координатах, то есть в её группе
      await createEntity(app.db, pid, classId, lead.sectorId, lead.x, lead.y);
      return respondWithState(app, pid);
    },
  );

  /**
   * Дебаг: выдача ключа Цепи Миров — реальная продажа (Steam) в фазе 99,
   * здесь только механика применения ключа (ТЗ п. 4).
   */
  app.post<{ Body: { targetSectorId?: string } }>(
    '/debug/chain-key',
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const pid = req.user.pid;
      if (pid !== DEBUG_PID) {
        return reply.code(403).send({ error: 'ТОЛЬКО ДЛЯ КАПИТАНА DEBUG' });
      }
      const [row] = await app.db
        .insert(chainKeys)
        .values({ playerId: pid, targetSectorId: req.body?.targetSectorId ?? null, source: 'debug' })
        .returning();
      return { keyId: row!.id };
    },
  );
}
