import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import jwt from '@fastify/jwt';
import websocket from '@fastify/websocket';
import { createDb, DATABASE_URL, type Db } from './db/client';
import { loadServerConfig, type ServerConfig } from './game/config';
import { authRoutes } from './routes/auth';
import { creditsRoutes } from './routes/credits';
import { logRoutes } from './routes/log';
import { mapRoutes } from './routes/map';
import { queueRoutes } from './routes/queue';
import { stateRoutes } from './routes/state';
import { WsRegistry } from './ws';

declare module 'fastify' {
  interface FastifyInstance {
    db: Db;
    cfg: ServerConfig;
    wsRegistry: WsRegistry;
    authenticate: (req: FastifyRequest) => Promise<void>;
  }
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { pid: string };
    user: { pid: string };
  }
}

export interface BuildAppOptions {
  databaseUrl?: string;
  logger?: boolean;
}

/** Собирает приложение; используется index.ts и тестами (inject). */
export async function buildApp(opts: BuildAppOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: opts.logger ?? true });

  const { db, sql } = createDb(opts.databaseUrl ?? DATABASE_URL);
  app.decorate('db', db);
  app.decorate('cfg', await loadServerConfig(db));
  app.decorate('wsRegistry', new WsRegistry());
  app.addHook('onClose', async () => {
    await sql.end();
  });

  await app.register(jwt, { secret: process.env.JWT_SECRET ?? 'dev-secret-not-for-prod' });
  await app.register(websocket);

  app.decorate('authenticate', async (req: FastifyRequest) => {
    await req.jwtVerify();
  });

  app.get('/health', async () => ({ status: 'ok', name: 'tokencontrol-server' }));

  app.get('/config', async () => app.cfg.game);

  /** WS: токен в query (?token=), браузерный WebSocket не умеет заголовки. */
  app.get<{ Querystring: { token?: string } }>('/ws', { websocket: true }, (socket, req) => {
    try {
      const payload = app.jwt.verify<{ pid: string }>(req.query.token ?? '');
      app.wsRegistry.add(payload.pid, socket);
      socket.send(JSON.stringify({ type: 'hello', msg: 'TOKEN CONTROL LINK ESTABLISHED' }));
    } catch {
      socket.close(4001, 'unauthorized');
    }
  });

  await app.register(authRoutes);
  await app.register(stateRoutes);
  await app.register(mapRoutes);
  await app.register(queueRoutes);
  await app.register(creditsRoutes);
  await app.register(logRoutes);

  return app;
}
