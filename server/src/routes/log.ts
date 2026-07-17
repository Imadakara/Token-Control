import type { FastifyInstance } from 'fastify';
import type { LogResponse } from '@tokencontrol/shared';
import { and, desc, eq, lt } from 'drizzle-orm';
import { actionLog } from '../db/schema';

const PAGE = 50;

export async function logRoutes(app: FastifyInstance) {
  /** Журнал завершённых действий, свежие сверху (ТЗ п. 4.2.6). */
  app.get<{ Querystring: { cursor?: string } }>(
    '/log',
    { preHandler: [app.authenticate] },
    async (req): Promise<LogResponse> => {
      const pid = req.user.pid;
      const cursor = req.query.cursor ? Number(req.query.cursor) : null;

      const where = cursor
        ? and(eq(actionLog.playerId, pid), lt(actionLog.id, cursor))
        : eq(actionLog.playerId, pid);

      const rows = await app.db
        .select()
        .from(actionLog)
        .where(where)
        .orderBy(desc(actionLog.id))
        .limit(PAGE);

      return {
        entries: rows.map((r) => ({
          id: String(r.id),
          ts: r.ts.toISOString(),
          action: r.action as LogResponse['entries'][number]['action'],
          result: r.result,
          details: (r.details as Record<string, unknown>) ?? null,
        })),
        nextCursor: rows.length === PAGE ? String(rows[rows.length - 1]!.id) : null,
      };
    },
  );
}
