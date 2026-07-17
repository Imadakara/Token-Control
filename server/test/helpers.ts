import postgres from 'postgres';
import { buildApp } from '../src/app';
import { runMigrations } from '../src/db/migrate';

const ADMIN_URL =
  process.env.TEST_ADMIN_DATABASE_URL ??
  'postgres://tokencontrol:tokencontrol@localhost:5544/tokencontrol';

export const TEST_DB = 'tokencontrol_test';
export const TEST_DATABASE_URL = ADMIN_URL.replace(/\/[^/]+$/, `/${TEST_DB}`);

/** Пересоздаёт чистую тестовую БД и возвращает готовое приложение. */
export async function createTestApp() {
  const admin = postgres(ADMIN_URL, { max: 1 });
  try {
    await admin.unsafe(`DROP DATABASE IF EXISTS ${TEST_DB} WITH (FORCE)`);
    await admin.unsafe(`CREATE DATABASE ${TEST_DB}`);
  } finally {
    await admin.end();
  }
  await runMigrations(TEST_DATABASE_URL);
  return buildApp({ databaseUrl: TEST_DATABASE_URL, logger: false });
}

export async function authToken(app: Awaited<ReturnType<typeof createTestApp>>, name = 'tester') {
  const res = await app.inject({ method: 'POST', url: '/auth/dev', payload: { playerId: name } });
  return (res.json() as { token: string }).token;
}
