import type { FastifyInstance } from 'fastify';
import { eq, sql } from 'drizzle-orm';
import { players } from '../db/schema';
import { lockPlayer } from '../game/queue';
import { buildState, r3 } from '../game/state';

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
}
