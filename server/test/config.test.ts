import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { gameConfig } from '../src/db/schema';
import { loadServerConfig } from '../src/game/config';
import { createTestApp } from './helpers';

/**
 * Регрессия: `{...defaults, ...stored}` — мелкое слияние. Если в БД лежит
 * ЦЕЛИКОМ старая форма вложенного `actionCosts` (например, до переименования
 * jump_local→move/dock→interact и добавления attack/special в фазе 9), она
 * раньше полностью перекрывала дефолт — новые ключи читались как undefined,
 * что на живом сервере проявилось как «ПРЫЖОК В СЕКТОРЕ (undefined ОВМ)».
 */

let app: FastifyInstance;

beforeAll(async () => {
  app = await createTestApp();
}, 30_000);

afterAll(async () => {
  await app.close();
});

describe('серверный конфиг: устойчивость к устаревшей форме actionCosts', () => {
  it('новые типы приказов не теряются за старой строкой game_config в БД', async () => {
    const stale = {
      taskCooldownSec: 0,
      actionCosts: {
        scan: 10,
        jump_local: 100,
        jump_hyper: 1000,
        dock: 10,
        analyze: 100,
        mine: 100,
        pickup: 10,
      },
    };
    await app.db.update(gameConfig).set({ value: stale }).where(eq(gameConfig.key, 'game'));

    const { game } = await loadServerConfig(app.db);
    expect(game.actionCosts.move).toBe(100);
    expect(game.actionCosts.interact).toBe(10);
    expect(game.actionCosts.attack).toBe(100);
    expect(game.actionCosts.special).toBe(50);
    expect(game.actionCosts.scan).toBe(10);
    expect(game.taskCooldownSec).toBe(0); // из устаревшей строки — сохраняется
  });
});
