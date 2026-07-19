import type { FastifyInstance } from 'fastify';
import type { GalaxyMapResponse, SectorMapResponse, SectorObject } from '@tokencontrol/shared';
import { and, eq } from 'drizzle-orm';
import { knownObjects, objects, visitedSectors } from '../db/schema';
import { allChainLinks, hasGateInSector, reachableSectors } from '../game/chain';
import { leadEntity } from '../game/entities';
import { hasTech } from '../game/knowledge';
import { parseSectorId } from '../game/worldgen';

export async function mapRoutes(app: FastifyInstance) {
  /** Карта текущего сектора: только открытые сканированием объекты (ТЗ п. 4.2.2). */
  app.get(
    '/map/sector',
    { preHandler: [app.authenticate] },
    async (req, reply): Promise<SectorMapResponse> => {
      const pid = req.user.pid;
      // Карта показывает сектор ведущей сущности флота
      const lead = await leadEntity(app.db, pid);
      if (!lead) return reply.code(404).send({ error: 'entity not found' });

      const rows = await app.db
        .select({ obj: objects, level: knownObjects.level })
        .from(knownObjects)
        .innerJoin(objects, eq(knownObjects.objectId, objects.id))
        .where(and(eq(knownObjects.playerId, pid), eq(objects.sectorId, lead.sectorId)));

      const known: SectorObject[] = rows.map(({ obj, level }) => ({
        id: obj.id,
        sectorId: obj.sectorId,
        type: obj.type as SectorObject['type'],
        x: obj.x,
        y: obj.y,
        // Свойства и запасы раскрывает только анализ (ТЗ п. 6.5)
        props: level === 'analyzed' ? (obj.props as Record<string, unknown>) : null,
        resourceAmount: level === 'analyzed' ? obj.resourceAmount : null,
      }));

      return { sectorId: lead.sectorId, objects: known };
    },
  );

  /** Карта галактики: сетка секторов, посещённые помечены (ТЗ п. 4.2.3). */
  app.get(
    '/map/galaxy',
    { preHandler: [app.authenticate] },
    async (req, reply): Promise<GalaxyMapResponse> => {
      const pid = req.user.pid;
      const { world } = app.cfg;

      const lead = await leadEntity(app.db, pid);
      if (!lead) return reply.code(404).send({ error: 'entity not found' });

      const visited = await app.db
        .select({ sectorId: visitedSectors.sectorId })
        .from(visitedSectors)
        .where(eq(visitedSectors.playerId, pid));

      // Гиперпрыжок прямо сейчас возможен только с изученной технологией и
      // собственными вратами в текущем секторе (ТЗ v0.02 п. 4) — без них
      // список достижимых пуст независимо от рёбер Цепи.
      const canJump =
        (await hasTech(app.db, pid, 'nav.hyperjump')) &&
        (await hasGateInSector(app.db, pid, lead.sectorId));
      const reachable = canJump ? await reachableSectors(app.db, lead.sectorId) : [];

      return {
        currentSectorId: lead.sectorId,
        galaxyWidth: world.galaxyWidth,
        galaxyHeight: world.galaxyHeight,
        sectors: visited.map(({ sectorId }) => {
          const c = parseSectorId(sectorId)!;
          return { id: sectorId, gx: c.gx, gy: c.gy, visited: true };
        }),
        chainLinks: await allChainLinks(app.db),
        reachable,
      };
    },
  );
}
