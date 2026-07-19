import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { StateResponse } from '@tokencontrol/shared';
import { createEntity, getEntity } from '../src/game/entities';
import { addTask } from '../src/game/queue';
import { sweepQueueCompletions } from '../src/game/sweep';
import { authToken, createTestApp } from './helpers';

/**
 * Нагрузочная проверка каскада ОВМ (Strategy - Plan.md, Фаза 13, критерий:
 * «флот из 10 сущностей не деградирует по времени тика свипа»). applyOvm
 * делает до fleet.length+2 проходов по ВСЕМУ флоту на каждый вызов — тест
 * убеждается, что один тик свипа реально доводит до конца задачи всех 10
 * сущностей одним вызовом и укладывается в разумное время, а не только в то,
 * что код не падает.
 */

let app: FastifyInstance;

beforeAll(async () => {
  app = await createTestApp();
}, 30_000);

afterAll(async () => {
  await app.close();
});

function api(token: string) {
  const headers = { authorization: `Bearer ${token}` };
  return {
    state: async () =>
      (await app.inject({ method: 'GET', url: '/state', headers })).json() as StateResponse,
    submit: async (ovm: number) => {
      await app.inject({
        method: 'POST',
        url: '/credits/submit',
        headers,
        payload: {
          packetSeq: Math.floor(Date.now() + Math.random() * 1000),
          ovm,
          tokens: { input: 0, output: 0, cacheCreation: 0, cacheRead: 0 },
          intervalStart: new Date().toISOString(),
          intervalEnd: new Date().toISOString(),
        },
      });
    },
  };
}

describe('нагрузка: 10 сущностей в одном флоте', () => {
  it('один тик свипа доводит до конца все 10 задач и укладывается в разумное время', async () => {
    const pid = 'dev:load1';
    const t = api(await authToken(app, 'load1'));
    const lead = (await t.state()).entities[0]!;

    const entityIds = [lead.id];
    await app.db.transaction(async (tx) => {
      for (let i = 0; i < 9; i++) {
        const e = await createEntity(tx, pid, 'scout_mk1', lead.sectorId, i, i);
        entityIds.push(e.id);
      }
    });
    expect(entityIds).toHaveLength(10);

    // Кулдаун теста по умолчанию 0 (createTestApp) — задачи довершались бы
    // прямо внутри addTask, не оставляя свипу что делать. Для постановки
    // используем неспешный конфиг (как в queue.test.ts), чтобы все 10 задач
    // остались «активна, но не довершена» до явного вызова свипа ниже —
    // sweepQueueCompletions(app) уже использует настоящий app.cfg (кулдаун 0),
    // так что довершит их сразу же, без ручного сдвига activatedAt в прошлое.
    const slowCfg = { ...app.cfg, game: { ...app.cfg.game, taskCooldownSec: 30 } };

    // 10 сканирований по 10 ОВМ = 100 — буфер закрывает все сразу при постановке
    await t.submit(100);
    await app.db.transaction(async (tx) => {
      for (const id of entityIds) {
        const entity = (await getEntity(tx, id))!;
        await addTask({ db: tx, cfg: slowCfg, pid }, entity, 'scan', null);
      }
    });

    let state = await t.state();
    for (const e of state.entities) {
      expect(e.orders).toHaveLength(1);
      expect(e.orders[0]).toMatchObject({ status: 'active', progressOvm: 10, costOvm: 10 });
    }

    const startedAt = Date.now();
    await sweepQueueCompletions(app);
    const elapsedMs = Date.now() - startedAt;

    state = await t.state();
    expect(state.entities.every((e) => e.orders.length === 0)).toBe(true); // все 10 исполнены одним тиком
    // Разумный бюджет на 10 сущностей одним тиком: не тест абсолютной скорости
    // железа, а страховка от будущей O(n²)-регрессии в каскаде.
    expect(elapsedMs).toBeLessThan(5000);
  });
});
