import type { FastifyInstance } from 'fastify';
import type { AuthDevRequest, AuthResponse } from '@tokencontrol/shared';
import { eq } from 'drizzle-orm';
import { players } from '../db/schema';
import { createEntity } from '../game/entities';
import { ensureSectorGenerated, markVisited } from '../game/world';
import { pickHomeSector } from '../game/worldgen';

export async function authRoutes(app: FastifyInstance) {
  /**
   * Dev-заглушка (ТЗ п. 3.1: Steam auth ticket — отдельной фазой).
   * Создаёт игрока и первую сущность флота в его личном домашнем секторе
   * (ТЗ v0.02 п. 4) при первом входе.
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
      const home = pickHomeSector(pid, world);
      await ensureSectorGenerated(app.db, home, world);
      await app.db
        .insert(players)
        .values({ id: pid, homeSectorId: home })
        .onConflictDoNothing();
      await createEntity(app.db, pid, 'scout_mk1', home, 0, 0);
      await markVisited(app.db, pid, home);
    }

    return { token: app.jwt.sign({ pid }) };
  });
}
