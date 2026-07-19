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
  const game = await loadKey<GameConfig>(db, 'game', DEFAULT_GAME_CONFIG, mergeGameConfig);
  const world = await loadKey<WorldGenParams>(db, 'world', DEFAULT_WORLD);
  return { game, world };
}

/**
 * `{...defaults, ...stored}` мелкое: если в БД лежит целиком старый объект
 * `actionCosts` (например, до переименования/добавления типа приказа), он
 * целиком перекрывает дефолт — новые ключи (`move`, `attack`, ...) пропадают
 * как `undefined`. Вложенные Record-поля GameConfig домердживаем отдельно;
 * `WorldGenParams` в этом не нуждается — там нет вложенных объектов.
 */
function mergeGameConfig(defaults: GameConfig, stored: Partial<GameConfig>): GameConfig {
  return {
    ...defaults,
    ...stored,
    actionCosts: { ...defaults.actionCosts, ...stored.actionCosts },
    conversion: { ...defaults.conversion, ...stored.conversion },
    limits: { ...defaults.limits, ...stored.limits },
  };
}

async function loadKey<T>(
  db: Db,
  key: string,
  defaults: T,
  merge: (defaults: T, stored: Partial<T>) => T = (d, s) => ({ ...d, ...s }),
): Promise<T> {
  const rows = await db.select().from(gameConfig).where(eq(gameConfig.key, key));
  if (rows.length === 0) {
    await db.insert(gameConfig).values({ key, value: defaults }).onConflictDoNothing();
    return defaults;
  }
  // Мягкое слияние: новые поля дефолтов не теряются при старом значении в БД
  return merge(defaults, rows[0]!.value as Partial<T>);
}
