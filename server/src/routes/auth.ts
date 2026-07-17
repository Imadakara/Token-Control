import type { FastifyInstance } from 'fastify';
import type { AuthDevRequest, AuthResponse } from '@tokencontrol/shared';
import { eq } from 'drizzle-orm';
import { players, ships } from '../db/schema';
import { ensureSectorGenerated, markVisited } from '../game/world';

export async function authRoutes(app: FastifyInstance) {
  /**
   * Dev-заглушка (ТЗ п. 3.1: Steam auth ticket — отдельной фазой).
   * Создаёт игрока и корабль в стартовом секторе при первом входе.
   */
  app.post<{ Body: AuthDevRequest }>('/auth/dev', async (req, reply): Promise<AuthResponse> => {
    const name = req.body?.playerId?.trim();
    if (!name || !/^[\w-]{1,64}$/.test(name)) {
      return reply.code(400).send({ error: 'playerId: 1-64 символов [a-zA-Z0-9_-]' });
    }
    const pid = `dev:${name}`;
    const { world } = app.cfg;

    const existing = await app.db.select().from(players).where(eq(players.id, pid));
    if (existing.length === 0) {
      await ensureSectorGenerated(app.db, world.startSector, world);
      await app.db.insert(players).values({ id: pid }).onConflictDoNothing();
      await app.db
        .insert(ships)
        .values({ playerId: pid, sectorId: world.startSector, x: 0, y: 0 })
        .onConflictDoNothing();
      await markVisited(app.db, pid, world.startSector);
    }

    return { token: app.jwt.sign({ pid }) };
  });
}
