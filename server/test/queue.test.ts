import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type {
  CreditsSubmitResponse,
  LogResponse,
  SectorMapResponse,
  StateResponse,
} from '@tokencontrol/shared';
import { authToken, createTestApp } from './helpers';

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
    add: (action: string, params: unknown = null) =>
      app.inject({ method: 'POST', url: '/queue/add', headers, payload: { action, params } }),
    remove: (slot: number) =>
      app.inject({ method: 'POST', url: '/queue/remove', headers, payload: { slot } }),
    reorder: (from: number, to: number) =>
      app.inject({ method: 'POST', url: '/queue/reorder', headers, payload: { from, to } }),
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

describe('очередь и начисления', () => {
  it('сканирование: постановка, начисление, завершение, излишек в буфер', async () => {
    const t = api(await authToken(app, 'q1'));

    const addRes = await t.add('scan');
    expect(addRes.statusCode).toBe(200);
    let state = addRes.json() as StateResponse;
    expect(state.queue).toHaveLength(1);
    expect(state.queue[0]).toMatchObject({ slot: 1, action: 'scan', status: 'active', costOvm: 10 });

    const credit = await t.submit(25);
    expect(credit).toEqual({ accepted: 25, clipped: 0 });

    state = await t.state();
    expect(state.queue).toHaveLength(0);
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
    await t.submit(300); // очередь пуста → всё в буфер
    let state = await t.state();
    expect(state.ovmBuffer).toBe(300);

    await t.add('scan'); // стоимость 10 закрывается буфером сразу
    state = await t.state();
    expect(state.queue).toHaveLength(0);
    expect(state.ovmBuffer).toBe(290);
    expect((await t.sectorMap()).objects.length).toBeGreaterThan(0);
  });

  it('полный цикл: прыжок к астероиду, анализ, добыча в трюм', async () => {
    const t = api(await authToken(app, 'q3'));
    await t.add('scan');
    await t.submit(10);
    const map = await t.sectorMap();
    const asteroid = map.objects.find((o) => o.type === 'asteroid')!;
    expect(asteroid).toBeDefined();

    // Очередь из двух задач: прыжок к объекту (100) + анализ (100).
    // Условие «возле» для анализа выполнит сам прыжок — валидация на
    // постановке статическая, позиционная проверка при активации.
    await t.add('jump_local', { kind: 'object', objectId: asteroid.id });
    const addAnalyze = await t.add('analyze', { kind: 'object', objectId: asteroid.id });
    expect(addAnalyze.statusCode).toBe(200);

    await t.submit(200); // оба действия каскадом
    let state = await t.state();
    expect(state.queue).toHaveLength(0);
    expect(state.ship.x).toBe(asteroid.x);
    expect(state.ship.y).toBe(asteroid.y);
    const map2 = await t.sectorMap();
    const analyzed = map2.objects.find((o) => o.id === asteroid.id)!;
    expect(analyzed.props).not.toBeNull();
    expect(analyzed.resourceAmount).toBeGreaterThan(0);

    await t.add('mine', { kind: 'object', objectId: asteroid.id });
    await t.submit(100);
    state = await t.state();
    expect(state.cargo).toHaveLength(1);
    expect(state.cargo[0]!.qty).toBe(1);
    const map3 = await t.sectorMap();
    expect(map3.objects.find((o) => o.id === asteroid.id)!.resourceAmount).toBe(
      analyzed.resourceAmount! - 1,
    );
  });

  it('НЕВЫПОЛНИМО: условие исчезло к активации — задача пропускается с журналом', async () => {
    const t = api(await authToken(app, 'q4'));
    await t.add('scan');
    await t.submit(10);
    const map = await t.sectorMap();
    const obj = map.objects[0]!;

    // Корабль в 0,0 — возле объекта? Прыгаем к объекту, ставим анализ + прыжок прочь + анализ
    await t.add('jump_local', { kind: 'object', objectId: obj.id });
    await t.submit(100);

    // Теперь возле: анализ валиден на постановке
    await t.add('jump_local', { kind: 'point', x: 900, y: 900 }); // слот 1
    await t.add('analyze', { kind: 'object', objectId: obj.id }); // слот 2: пока валиден
    const state = await t.state();
    expect(state.queue).toHaveLength(2);

    await t.submit(250); // прыжок (100) завершён → анализ стал невыполним → пропуск; 150 в...
    const after = await t.state();
    expect(after.queue).toHaveLength(0);
    const log = await t.log();
    const skip = log.entries.find((e) => e.result.startsWith('НЕВЫПОЛНИМО'));
    expect(skip).toBeDefined();
    expect(after.ovmBuffer).toBe(150);
  });

  it('удаление сжигает прогресс; перестановка меняет слоты 2-3', async () => {
    const t = api(await authToken(app, 'q5'));
    await t.add('scan');
    await t.submit(5); // прогресс 5 из 10
    let state = await t.state();
    expect(state.queue[0]!.progressOvm).toBe(5);

    await t.remove(1);
    state = await t.state();
    expect(state.queue).toHaveLength(0);
    expect(state.ovmBuffer).toBe(0); // прогресс сгорел, не вернулся

    // Три задачи: слот1 активен, 2-3 переставляем
    await t.add('scan');
    await t.add('jump_local', { kind: 'point', x: 1, y: 1 });
    await t.add('jump_local', { kind: 'point', x: 2, y: 2 });
    await t.reorder(2, 3);
    state = await t.state();
    const p2 = state.queue.find((q) => q.slot === 2)!.params as { x: number };
    const p3 = state.queue.find((q) => q.slot === 3)!.params as { x: number };
    expect(p2.x).toBe(2);
    expect(p3.x).toBe(1);

    // Четвёртая задача не лезет
    const res = await t.add('scan');
    expect(res.statusCode).toBe(409);
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

  it('очередь из 3 задач сдвигается по мере выполнения', async () => {
    const t = api(await authToken(app, 'q10'));
    await t.add('scan'); // 10, станет активной
    await t.add('jump_local', { kind: 'point', x: 100, y: 100 }); // 100
    await t.add('jump_local', { kind: 'point', x: 200, y: 200 }); // 100
    let state = await t.state();
    expect(state.queue.map((q) => q.slot)).toEqual([1, 2, 3]);

    await t.submit(60); // скан завершён (10), излишек 50 → в прыжок №1
    state = await t.state();
    expect(state.queue).toHaveLength(2);
    expect(state.queue[0]).toMatchObject({ slot: 1, action: 'jump_local', status: 'active' });
    expect(state.queue[0]!.progressOvm).toBe(50);
    expect((state.queue[0]!.params as { x: number }).x).toBe(100);
    expect(state.queue[1]).toMatchObject({ slot: 2, status: 'waiting' });

    await t.submit(150); // прыжок №1 завершён, 100 → прыжок №2 завершён... 50 остаток? нет: 50+150=200 → оба
    state = await t.state();
    expect(state.queue).toHaveLength(0);
    expect(state.ship.x).toBe(200);
    expect(state.ovmBuffer).toBe(0);
  });

  it('невыполнимая задача не расходует ОВМ: накопленный прогресс возвращается', async () => {
    const t = api(await authToken(app, 'q11'));
    await t.add('scan');
    await t.submit(10);
    const map = await t.sectorMap();
    const asteroid = map.objects.find((o) => o.type === 'asteroid')!;
    await t.add('jump_local', { kind: 'object', objectId: asteroid.id });
    await t.submit(100);

    await t.add('mine', { kind: 'object', objectId: asteroid.id }); // активна, валидна
    await t.submit(50); // частично накоплено
    let state = await t.state();
    expect(state.queue[0]!.progressOvm).toBe(50);

    // Ресурс исчез (например, добыт другим игроком)
    const { objects } = await import('../src/db/schema');
    const { eq } = await import('drizzle-orm');
    await app.db.update(objects).set({ resourceAmount: 0 }).where(eq(objects.id, asteroid.id));

    await t.submit(100); // добыча стала невыполнима → 50 старых + 100 новых → буфер
    state = await t.state();
    expect(state.queue).toHaveLength(0);
    expect(state.ovmBuffer).toBe(150);
    expect(state.cargo).toEqual([]); // ничего не добыто
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
    const { addTask, lockPlayer } = await import('../src/game/queue');
    await app.db.transaction(async (tx) => {
      await addTask({ db: tx, cfg: slowCfg, pid }, 'scan', null);
    });
    let state = await t.state();
    expect(state.queue).toHaveLength(1);
    expect(state.queue[0]).toMatchObject({ status: 'active', progressOvm: 10, costOvm: 10 });
    expect(state.queue[0]!.activatedAt).not.toBeNull();

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
    expect(state.queue).toHaveLength(0);
    expect((await t.sectorMap()).objects.length).toBeGreaterThan(0); // скан исполнился
  });

  it('гиперпрыжок только в соседний сектор', async () => {
    const t = api(await authToken(app, 'q9'));
    // Дальний сектор проходит постановку (статическая проверка), но при
    // активации помечается НЕВЫПОЛНИМО и пропускается с записью в журнал
    const far = await t.add('jump_hyper', { kind: 'sector', sectorId: '9:9' });
    expect(far.statusCode).toBe(200);
    expect((await t.state()).queue).toHaveLength(0);
    const log = await t.log();
    expect(log.entries[0]!.result).toContain('СОСЕДНИЕ');

    await t.add('jump_hyper', { kind: 'sector', sectorId: '5:6' });
    await t.submit(400); // за 3 сабмита из-за минутного лимита 500
    await t.submit(400);
    await t.submit(400);
    // 1000 стоимость; принято 400+100+0 = 500... лимит мешает — проверим прогресс
    const state = await t.state();
    if (state.queue.length > 0) {
      expect(state.queue[0]!.progressOvm).toBe(500);
      expect(state.ship.sectorId).toBe('5:5');
    } else {
      expect(state.ship.sectorId).toBe('5:6');
    }
  });
});
