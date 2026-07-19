import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type {
  CreditsSubmitResponse,
  LogResponse,
  OrdersAddResponse,
  SectorMapResponse,
  StateResponse,
} from '@tokencontrol/shared';
import { authToken, createTestApp } from './helpers';

/**
 * Движок очереди приказов (game/queue.ts) через реальный API /orders/*.
 * До фазы 8 это был /queue/* на «корабле игрока»; сейчас у каждого игрока в
 * тесте ровно одна сущность, так что state.entities[0] играет ту же роль,
 * что раньше state.ship/state.queue/state.cargo — сам движок не менялся.
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
    sectorMap: async () =>
      (await app.inject({ method: 'GET', url: '/map/sector', headers })).json() as SectorMapResponse,
    log: async () =>
      (await app.inject({ method: 'GET', url: '/log', headers })).json() as LogResponse,
    add: (entityId: string, action: string, params: unknown = null) =>
      app.inject({
        method: 'POST',
        url: '/orders/add',
        headers,
        payload: { entityIds: [entityId], action, params },
      }),
    remove: (entityId: string, slot: number) =>
      app.inject({ method: 'POST', url: '/orders/remove', headers, payload: { entityId, slot } }),
    reorder: (entityId: string, from: number, to: number) =>
      app.inject({
        method: 'POST',
        url: '/orders/reorder',
        headers,
        payload: { entityId, from, to },
      }),
    submit: async (ovm: number, packetSeq = Date.now() + Math.random() * 1000) => {
      const res = await app.inject({
        method: 'POST',
        url: '/credits/submit',
        headers,
        payload: {
          packetSeq: Math.floor(packetSeq),
          ovm,
          tokens: { input: 0, output: 0, cacheCreation: 0, cacheRead: 0 },
          intervalStart: new Date().toISOString(),
          intervalEnd: new Date().toISOString(),
        },
      });
      return res.json() as CreditsSubmitResponse;
    },
  };
}

/** Постановка приказа возвращает {results, state} — тут нужен только state. */
function stateOf(res: { json: () => unknown }): StateResponse {
  return (res.json() as OrdersAddResponse).state;
}

describe('очередь и начисления', () => {
  it('сканирование: постановка, начисление, завершение, излишек в буфер', async () => {
    const t = api(await authToken(app, 'q1'));
    const id = (await t.state()).entities[0]!.id;

    const addRes = await t.add(id, 'scan');
    expect(addRes.statusCode).toBe(200);
    let state = stateOf(addRes);
    expect(state.entities[0]!.orders).toHaveLength(1);
    expect(state.entities[0]!.orders[0]).toMatchObject({
      slot: 1,
      action: 'scan',
      status: 'active',
      costOvm: 10,
    });

    const credit = await t.submit(25);
    expect(credit).toEqual({ accepted: 25, clipped: 0 });

    state = await t.state();
    expect(state.entities[0]!.orders).toHaveLength(0);
    expect(state.ovmBuffer).toBe(15); // 25 - 10

    const map = await t.sectorMap();
    expect(map.objects.length).toBeGreaterThan(0);
    // До анализа свойства скрыты
    expect(map.objects[0]!.props).toBeNull();

    const log = await t.log();
    expect(log.entries[0]!.result).toContain('СКАНИРОВАНИЕ');
  });

  it('буфер заполняет счётчик при постановке: задача исполняется мгновенно', async () => {
    const t = api(await authToken(app, 'q2'));
    const id = (await t.state()).entities[0]!.id;
    await t.submit(300); // очередь пуста → всё в буфер
    let state = await t.state();
    expect(state.ovmBuffer).toBe(300);

    await t.add(id, 'scan'); // стоимость 10 закрывается буфером сразу
    state = await t.state();
    expect(state.entities[0]!.orders).toHaveLength(0);
    expect(state.ovmBuffer).toBe(290);
    expect((await t.sectorMap()).objects.length).toBeGreaterThan(0);
  });

  it('полный цикл: прыжок к астероиду, анализ, добыча в трюм', async () => {
    const t = api(await authToken(app, 'q3'));
    const id = (await t.state()).entities[0]!.id;
    await t.add(id, 'scan');
    await t.submit(10);
    const map = await t.sectorMap();
    const asteroid = map.objects.find((o) => o.type === 'asteroid')!;
    expect(asteroid).toBeDefined();

    // Очередь из двух приказов: прыжок к объекту (100) + анализ (100).
    // Условие «возле» для анализа выполнит сам прыжок — валидация на
    // постановке статическая, позиционная проверка при активации.
    await t.add(id, 'move', { kind: 'object', objectId: asteroid.id });
    const addAnalyze = await t.add(id, 'analyze', { kind: 'object', objectId: asteroid.id });
    expect(addAnalyze.statusCode).toBe(200);

    await t.submit(200); // оба приказа каскадом
    let state = await t.state();
    let entity = state.entities[0]!;
    expect(entity.orders).toHaveLength(0);
    expect(entity.x).toBe(asteroid.x);
    expect(entity.y).toBe(asteroid.y);
    const map2 = await t.sectorMap();
    const analyzed = map2.objects.find((o) => o.id === asteroid.id)!;
    expect(analyzed.props).not.toBeNull();
    expect(analyzed.resourceAmount).toBeGreaterThan(0);

    await t.add(id, 'mine', { kind: 'object', objectId: asteroid.id });
    await t.submit(100);
    state = await t.state();
    entity = state.entities[0]!;
    expect(entity.cargo).toHaveLength(1);
    expect(entity.cargo[0]!.qty).toBe(1);
    const map3 = await t.sectorMap();
    expect(map3.objects.find((o) => o.id === asteroid.id)!.resourceAmount).toBe(
      analyzed.resourceAmount! - 1,
    );
  });

  it('НЕВЫПОЛНИМО: условие исчезло к активации — задача пропускается с журналом', async () => {
    const t = api(await authToken(app, 'q4'));
    const id = (await t.state()).entities[0]!.id;
    await t.add(id, 'scan');
    await t.submit(10);
    const map = await t.sectorMap();
    const obj = map.objects[0]!;

    // Сущность в 0,0 — возле объекта? Прыгаем к объекту, ставим анализ + прыжок прочь + анализ
    await t.add(id, 'move', { kind: 'object', objectId: obj.id });
    await t.submit(100);

    // Теперь возле: анализ валиден на постановке
    await t.add(id, 'move', { kind: 'point', x: 900, y: 900 }); // слот 1
    await t.add(id, 'analyze', { kind: 'object', objectId: obj.id }); // слот 2: пока валиден
    const state = await t.state();
    expect(state.entities[0]!.orders).toHaveLength(2);

    await t.submit(250); // прыжок (100) завершён → анализ стал невыполним → пропуск; 150 в...
    const after = await t.state();
    expect(after.entities[0]!.orders).toHaveLength(0);
    const log = await t.log();
    const skip = log.entries.find((e) => e.result.startsWith('НЕВЫПОЛНИМО'));
    expect(skip).toBeDefined();
    expect(after.ovmBuffer).toBe(150);
  });

  it('удаление сжигает прогресс; перестановка меняет слоты 2-3', async () => {
    const t = api(await authToken(app, 'q5'));
    const id = (await t.state()).entities[0]!.id;
    await t.add(id, 'scan');
    await t.submit(5); // прогресс 5 из 10
    let state = await t.state();
    expect(state.entities[0]!.orders[0]!.progressOvm).toBe(5);

    await t.remove(id, 1);
    state = await t.state();
    expect(state.entities[0]!.orders).toHaveLength(0);
    expect(state.ovmBuffer).toBe(0); // прогресс сгорел, не вернулся

    // Три приказа: слот1 активен, 2-3 переставляем
    await t.add(id, 'scan');
    await t.add(id, 'move', { kind: 'point', x: 1, y: 1 });
    await t.add(id, 'move', { kind: 'point', x: 2, y: 2 });
    await t.reorder(id, 2, 3);
    state = await t.state();
    const orders = state.entities[0]!.orders;
    const p2 = orders.find((q) => q.slot === 2)!.params as { x: number };
    const p3 = orders.find((q) => q.slot === 3)!.params as { x: number };
    expect(p2.x).toBe(2);
    expect(p3.x).toBe(1);

    // Четвёртый приказ не лезет: веерная рассылка не бросает 409, а отвечает ok:false
    const res = await t.add(id, 'scan');
    expect(res.statusCode).toBe(200);
    const body = res.json() as OrdersAddResponse;
    expect(body.results[0]).toMatchObject({ ok: false, reason: 'ОЧЕРЕДЬ ЗАПОЛНЕНА' });
  });

  it('идемпотентность: повтор пакета не задваивает начисление', async () => {
    const t = api(await authToken(app, 'q6'));
    const seq = 12345;
    const first = await t.submit(50, seq);
    expect(first.accepted).toBe(50);
    const replay = await t.submit(50, seq);
    expect(replay).toEqual(first);
    const state = await t.state();
    expect(state.ovmBuffer).toBe(50); // не 100
  });

  it('лимиты: превышение минутного потолка мягко урезается', async () => {
    const t = api(await authToken(app, 'q7'));
    const r1 = await t.submit(400);
    expect(r1).toEqual({ accepted: 400, clipped: 0 });
    const r2 = await t.submit(400); // осталось 100 из 500/мин
    expect(r2).toEqual({ accepted: 100, clipped: 300 });
    const r3 = await t.submit(50);
    expect(r3).toEqual({ accepted: 0, clipped: 50 });
  });

  it('кап буфера: излишек сверх 100000 игнорируется', async () => {
    const t = api(await authToken(app, 'q8'));
    // Прямое начисление в буфер через движок (лимиты обходим модульно)
    const { applyOvm } = await import('../src/game/queue');
    await app.db.transaction(async (tx) => {
      await applyOvm({ db: tx, cfg: app.cfg, pid: 'dev:q8' }, 150_000);
    });
    const state = await t.state();
    expect(state.ovmBuffer).toBe(100_000);
  });

  it('очередь из 3 приказов сдвигается по мере выполнения', async () => {
    const t = api(await authToken(app, 'q10'));
    const id = (await t.state()).entities[0]!.id;
    await t.add(id, 'scan'); // 10, станет активной
    await t.add(id, 'move', { kind: 'point', x: 100, y: 100 }); // 100
    await t.add(id, 'move', { kind: 'point', x: 200, y: 200 }); // 100
    let state = await t.state();
    expect(state.entities[0]!.orders.map((q) => q.slot)).toEqual([1, 2, 3]);

    await t.submit(60); // скан завершён (10), излишек 50 → в прыжок №1
    state = await t.state();
    let orders = state.entities[0]!.orders;
    expect(orders).toHaveLength(2);
    expect(orders[0]).toMatchObject({ slot: 1, action: 'move', status: 'active' });
    expect(orders[0]!.progressOvm).toBe(50);
    expect((orders[0]!.params as { x: number }).x).toBe(100);
    expect(orders[1]).toMatchObject({ slot: 2, status: 'waiting' });

    await t.submit(150); // прыжок №1 завершён, 100 → прыжок №2 завершён... 50 остаток? нет: 50+150=200 → оба
    state = await t.state();
    expect(state.entities[0]!.orders).toHaveLength(0);
    expect(state.entities[0]!.x).toBe(200);
    expect(state.ovmBuffer).toBe(0);
  });

  it('невыполнимая задача не расходует ОВМ: накопленный прогресс возвращается', async () => {
    const t = api(await authToken(app, 'q11'));
    const id = (await t.state()).entities[0]!.id;
    await t.add(id, 'scan');
    await t.submit(10);
    const map = await t.sectorMap();
    const asteroid = map.objects.find((o) => o.type === 'asteroid')!;
    await t.add(id, 'move', { kind: 'object', objectId: asteroid.id });
    await t.submit(100);

    await t.add(id, 'mine', { kind: 'object', objectId: asteroid.id }); // активна, валидна
    await t.submit(50); // частично накоплено
    let state = await t.state();
    expect(state.entities[0]!.orders[0]!.progressOvm).toBe(50);

    // Ресурс исчез (например, добыт другим игроком)
    const { objects } = await import('../src/db/schema');
    const { eq } = await import('drizzle-orm');
    await app.db.update(objects).set({ resourceAmount: 0 }).where(eq(objects.id, asteroid.id));

    await t.submit(100); // добыча стала невыполнима → 50 старых + 100 новых → буфер
    state = await t.state();
    expect(state.entities[0]!.orders).toHaveLength(0);
    expect(state.ovmBuffer).toBe(150);
    expect(state.entities[0]!.cargo).toEqual([]); // ничего не добыто
    const log = await t.log();
    expect(log.entries[0]!.result).toContain('НЕВЫПОЛНИМО');
  });

  it('кулдаун: заполненная задача исполняется свипом, а не мгновенно', async () => {
    const pid = 'dev:q12';
    const t = api(await authToken(app, 'q12'));
    await t.submit(200); // в буфер

    // Постановка с кулдауном 5с: буфер закрывает стоимость, но исполнения нет
    const slowCfg = {
      ...app.cfg,
      game: { ...app.cfg.game, taskCooldownSec: 5 },
    };
    const { addTask } = await import('../src/game/queue');
    const { leadEntity } = await import('../src/game/entities');
    await app.db.transaction(async (tx) => {
      const entity = (await leadEntity(tx, pid))!;
      await addTask({ db: tx, cfg: slowCfg, pid }, entity, 'scan', null);
    });
    let state = await t.state();
    expect(state.entities[0]!.orders).toHaveLength(1);
    expect(state.entities[0]!.orders[0]).toMatchObject({
      status: 'active',
      progressOvm: 10,
      costOvm: 10,
    });
    expect(state.entities[0]!.orders[0]!.activatedAt).not.toBeNull();

    // Кулдаун «прошёл» (сдвигаем активацию в прошлое) → свип довершает
    const { queues } = await import('../src/db/schema');
    const { eq } = await import('drizzle-orm');
    await app.db
      .update(queues)
      .set({ activatedAt: new Date(Date.now() - 10_000) })
      .where(eq(queues.playerId, pid));
    const { sweepQueueCompletions } = await import('../src/game/sweep');
    await sweepQueueCompletions(app);

    state = await t.state();
    expect(state.entities[0]!.orders).toHaveLength(0);
    expect((await t.sectorMap()).objects.length).toBeGreaterThan(0); // скан исполнился
  });

  it('гиперпрыжок только в соседний сектор', async () => {
    const t = api(await authToken(app, 'q9'));
    const id = (await t.state()).entities[0]!.id;
    const { DEFAULT_WORLD, parseSectorId, pickHomeSector } = await import('../src/game/worldgen');
    const home = pickHomeSector('dev:q9', DEFAULT_WORLD);
    const { gx, gy } = parseSectorId(home)!;
    const neighbour = gx + 1 < DEFAULT_WORLD.galaxyWidth ? `${gx + 1}:${gy}` : `${gx - 1}:${gy}`;
    const far = `${(gx + 5) % DEFAULT_WORLD.galaxyWidth}:${(gy + 5) % DEFAULT_WORLD.galaxyHeight}`;

    // Дальний сектор проходит постановку (статическая проверка), но при
    // активации помечается НЕВЫПОЛНИМО и пропускается с записью в журнал
    const farRes = await t.add(id, 'jump_hyper', { kind: 'sector', sectorId: far });
    expect(farRes.statusCode).toBe(200);
    expect((farRes.json() as OrdersAddResponse).results[0]).toMatchObject({ ok: true });
    expect((await t.state()).entities[0]!.orders).toHaveLength(0);
    const log = await t.log();
    expect(log.entries[0]!.result).toContain('СОСЕДНИЕ');

    await t.add(id, 'jump_hyper', { kind: 'sector', sectorId: neighbour });
    await t.submit(400); // за 3 сабмита из-за минутного лимита 500
    await t.submit(400);
    await t.submit(400);
    // 1000 стоимость; принято 400+100+0 = 500 — лимит мешает, проверим прогресс
    const state = await t.state();
    const entity = state.entities[0]!;
    if (entity.orders.length > 0) {
      expect(entity.orders[0]!.progressOvm).toBe(500);
      expect(entity.sectorId).toBe(home);
    } else {
      expect(entity.sectorId).toBe(neighbour);
    }
  });
});
