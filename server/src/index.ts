import { buildApp } from './app';
import { DATABASE_URL } from './db/client';
import { runMigrations } from './db/migrate';
import { startRegenTimer } from './game/regen';

// Намеренно не PORT: раннеры превью подставляют PORT для фронтенда.
const PORT = Number(process.env.GAME_SERVER_PORT ?? 8787);

await runMigrations(DATABASE_URL);

const app = await buildApp();
startRegenTimer(app.db);

try {
  await app.listen({ port: PORT, host: '127.0.0.1' });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
