import { buildApp } from './app';
import { DATABASE_URL } from './db/client';
import { runMigrations } from './db/migrate';
import { loadServerConfig } from './game/config';
import { startRegenTimer } from './game/regen';

// Намеренно не PORT: раннеры превью подставляют PORT для фронтенда.
const PORT = Number(process.env.GAME_SERVER_PORT ?? 8787);

await runMigrations(DATABASE_URL);

const app = await buildApp();
startRegenTimer(app.db);

// Hot-reload конфига (ТЗ п. 12.2): правка game_config в БД применяется
// без рестарта; клиенты узнают по WS.
setInterval(() => {
  void loadServerConfig(app.db)
    .then((fresh) => {
      if (JSON.stringify(fresh) !== JSON.stringify(app.cfg)) {
        Object.assign(app.cfg, fresh);
        app.wsRegistry.broadcast({ type: 'config_changed', config: app.cfg.game });
        app.log.info('game config reloaded');
      }
    })
    .catch((err) => app.log.error(err, 'config reload failed'));
}, 60_000).unref();

try {
  await app.listen({ port: PORT, host: '127.0.0.1' });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
