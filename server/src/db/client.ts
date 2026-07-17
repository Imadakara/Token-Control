import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

export const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgres://tokencontrol:tokencontrol@localhost:5544/tokencontrol';

export function createDb(url: string = DATABASE_URL) {
  const sql = postgres(url, { max: 10 });
  return { db: drizzle(sql, { schema }), sql };
}

export type Db = ReturnType<typeof createDb>['db'];
