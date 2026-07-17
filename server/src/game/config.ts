import { DEFAULT_GAME_CONFIG, type GameConfig } from '@tokencontrol/shared';
import { eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { gameConfig } from '../db/schema';
import { DEFAULT_WORLD, type WorldGenParams } from './worldgen';

export interface ServerConfig {
  game: GameConfig;
  world: WorldGenParams;
}

/**
 * Конфиг хранится в game_config по ключам 'game' и 'world'; отсутствующие
 * ключи засеваются дефолтами при старте. Правка в БД = калибровка без релиза.
 */
export async function loadServerConfig(db: Db): Promise<ServerConfig> {
  const game = await loadKey<GameConfig>(db, 'game', DEFAULT_GAME_CONFIG);
  const world = await loadKey<WorldGenParams>(db, 'world', DEFAULT_WORLD);
  return { game, world };
}

async function loadKey<T>(db: Db, key: string, defaults: T): Promise<T> {
  const rows = await db.select().from(gameConfig).where(eq(gameConfig.key, key));
  if (rows.length === 0) {
    await db.insert(gameConfig).values({ key, value: defaults }).onConflictDoNothing();
    return defaults;
  }
  // Мягкое слияние: новые поля дефолтов не теряются при старом значении в БД
  return { ...defaults, ...(rows[0]!.value as Partial<T>) };
}
