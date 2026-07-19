import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { OrdersAddResponse, StateResponse } from '@tokencontrol/shared';
import { authToken, createTestApp } from './helpers';

/**
 * Флот и приоритетная раздача общего потока ОВМ (ТЗ v0.02 пп. 2-3).
 * Ключевой инвариант: при одной сущности движок ведёт себя как однокорабельный
 * MVP — это проверяет queue.test.ts, который остался без правок логики.
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
    headers,
    state: async () =>
      (await app.inject({ method: 'GET', url: '/state', headers })).json() as StateResponse,
    order: async (entityIds: string[], action: string, params: unknown = null) =>
      (await app.inject({
        method: 'POST',
        url: '/orders/add',
        headers,
        payload: { entityIds, action, params },
      })).json() as OrdersAddResponse,
    removeOrder: (entityId: string, slot: number) =>
      app.inject({ method: 'POST', url: '/orders/remove', headers, payload: { entityId, slot } }),
    priority: (entityIds: string[]) =>
      app.inject({ method: 'POST', url: '/fleet/priority', headers, payload: { entityIds } }),
    rename: (entityId: string, name: string) =>
      app.inject({ method: 'POST', url: '/fleet/rename', headers, payload: { entityId, name } }),
    submit: async (ovm: number, packetSeq = Math.floor(Date.now() + Math.random() * 1000)) => {
      await app.inject({
        method: 'POST',
        url: '/credits/submit',
        headers,
        payload: {
          packetSeq,
          ovm,
          tokens: { input: 0, output: 0, cacheCreation: 0, cacheRead: 0 },
          intervalStart: new Date().toISOString(),
          intervalEnd: new Date().toISOString(),
        },
      });
    },
  };
}

/** Добавляет игроку вторую сущность рядом с ведущей. */
async function spawn(pid: string, classId = 'scout_mk1'): Promise<string> {
  const { createEntity, leadEntity } = await import('../src/game/entities');
  const lead = (await leadEntity(app.db, pid))!;
  const row = await createEntity(
    app.db,
    pid,
    classId as 'scout_mk1',
    lead.sectorId,
    lead.x,
    lead.y,
  );
  return row.id;
}

describe('флот', () => {
  it('вторая сущность видна в состоянии со своими параметрами и группой', async () => {
    const t = api(await authToken(app, 'f1'));
    await spawn('dev:f1', 'hauler_mk1');

    const state = await t.state();
    expect(state.entities).toHaveLength(2);
    const [a, b] = state.entities;
    expect(a!.name).toBe('БОРТ-001');
    expect(b!.name).toBe('ТРЮМ-001');
    // Обе в одних координатах → одна группа (ТЗ v0.02 п. 2.1)
    expect(a!.groupKey).toBe(b!.groupKey);
    // Вместимость трюма берётся из класса, а не из общего конфига
    expect(b!.cargoCapacity).toBeGreaterThan(a!.cargoCapacity);
    expect(state.entities.every((e) => e.status === 'idle')).toBe(true);
  });

  it('поток ОВМ идёт приоритетной сущности, вторая ждёт', async () => {
    const t = api(await authToken(app, 'f2'));
    const secondId = await spawn('dev:f2');
    let state = await t.state();
    const firstId = state.entities[0]!.id;

    // Обеим — по прыжку (100 ОВМ каждый)
    await t.order([firstId], 'jump_local', { kind: 'point', x: 100, y: 100 });
    await t.order([secondId], 'jump_local', { kind: 'point', x: 200, y: 200 });

    await t.submit(60);
    state = await t.state();
    const first = state.entities.find((e) => e.id === firstId)!;
    const second = state.entities.find((e) => e.id === secondId)!;
    expect(first.orders[0]!.progressOvm).toBe(60);
    expect(second.orders[0]!.progressOvm).toBe(0);
    expect(first.status).toBe('busy');
    expect(second.status).toBe('starved');

    // Излишек завершённого приказа каскадом уходит второй сущности
    await t.submit(100); // 60+100 = 160: первой хватает (100), 60 → второй
    state = await t.state();
    expect(state.entities.find((e) => e.id === firstId)!.orders).toHaveLength(0);
    expect(state.entities.find((e) => e.id === firstId)!.x).toBe(100);
    expect(state.entities.find((e) => e.id === secondId)!.orders[0]!.progressOvm).toBe(60);
    expect(state.ovmBuffer).toBe(0);
  });

  it('перестановка приоритета меняет получателя потока', async () => {
    const t = api(await authToken(app, 'f3'));
    const secondId = await spawn('dev:f3');
    const firstId = (await t.state()).entities[0]!.id;

    const res = await t.priority([secondId, firstId]);
    expect(res.statusCode).toBe(200);

    await t.order([firstId], 'jump_local', { kind: 'point', x: 10, y: 10 });
    await t.order([secondId], 'jump_local', { kind: 'point', x: 20, y: 20 });
    await t.submit(50);

    const state = await t.state();
    expect(state.entities[0]!.id).toBe(secondId); // порядок в снапшоте — по приоритету
    expect(state.entities.find((e) => e.id === secondId)!.orders[0]!.progressOvm).toBe(50);
    expect(state.entities.find((e) => e.id === firstId)!.orders[0]!.progressOvm).toBe(0);
  });

  it('кулдаун одной сущности не морозит поток остальным', async () => {
    const pid = 'dev:f4';
    const t = api(await authToken(app, 'f4'));
    const secondId = await spawn(pid);
    const firstId = (await t.state()).entities[0]!.id;

    // Кулдаун задаётся в конфиге приложения: именно его читает движок при
    // исполнении. Подменять cfg только в вызове addTask бессмысленно —
    // начисления приходят через HTTP и видят app.cfg.
    const original = app.cfg.game.taskCooldownSec;
    app.cfg.game.taskCooldownSec = 60;
    try {
      // Приоритетной сущности — приказ, полностью оплаченный, но в кулдауне
      await t.order([firstId], 'scan');
      await t.submit(10);

      await t.order([secondId], 'jump_local', { kind: 'point', x: 300, y: 300 });
      await t.submit(80);

      const state = await t.state();
      const first = state.entities.find((e) => e.id === firstId)!;
      const second = state.entities.find((e) => e.id === secondId)!;
      expect(first.orders).toHaveLength(1); // всё ещё ждёт кулдауна
      expect(first.orders[0]!.progressOvm).toBe(10); // оплачен полностью
      expect(second.orders[0]!.progressOvm).toBe(80); // поток дотёк до второй
    } finally {
      app.cfg.game.taskCooldownSec = original;
    }
  });

  it('групповой приказ: одна постановка — приказы всем сущностям группы', async () => {
    const t = api(await authToken(app, 'f5'));
    const secondId = await spawn('dev:f5');
    const firstId = (await t.state()).entities[0]!.id;

    const res = await t.order([firstId, secondId], 'jump_local', { kind: 'point', x: 500, y: 500 });
    expect(res.results).toEqual([
      { entityId: firstId, ok: true },
      { entityId: secondId, ok: true },
    ]);
    expect(res.state.entities.every((e) => e.orders.length === 1)).toBe(true);
  });

  it('веерная рассылка: отказ одной сущности не отменяет приказ остальным', async () => {
    const t = api(await authToken(app, 'f6'));
    const gateId = await spawn('dev:f6', 'gate'); // стационарный объект
    const firstId = (await t.state()).entities[0]!.id;

    const res = await t.order([firstId, gateId], 'jump_local', { kind: 'point', x: 5, y: 5 });
    expect(res.results.find((r) => r.entityId === firstId)!.ok).toBe(true);
    const denied = res.results.find((r) => r.entityId === gateId)!;
    expect(denied.ok).toBe(false);
    expect(denied.reason).toBe('СУЩНОСТЬ НЕПОДВИЖНА');
    expect(res.state.entities.find((e) => e.id === gateId)!.orders).toHaveLength(0);
  });

  it('чужая сущность не принимает приказ', async () => {
    const t1 = api(await authToken(app, 'f7'));
    const t2 = api(await authToken(app, 'f8'));
    const alienId = (await t2.state()).entities[0]!.id;

    const res = await t1.order([alienId], 'scan');
    expect(res.results[0]).toMatchObject({ ok: false, reason: 'СУЩНОСТЬ НЕ НАЙДЕНА' });
  });

  it('трюм принадлежит сущности-добытчику, а не игроку', async () => {
    const pid = 'dev:f9';
    const t = api(await authToken(app, 'f9'));
    const minerId = (await t.state()).entities[0]!.id;
    const idleId = await spawn(pid);

    await t.order([minerId], 'scan');
    await t.submit(10);
    const map = (
      await app.inject({ method: 'GET', url: '/map/sector', headers: t.headers })
    ).json() as { objects: { id: string; type: string; x: number; y: number }[] };
    const asteroid = map.objects.find((o) => o.type === 'asteroid')!;

    await t.order([minerId], 'jump_local', { kind: 'object', objectId: asteroid.id });
    await t.submit(100);
    await t.order([minerId], 'mine', { kind: 'object', objectId: asteroid.id });
    await t.submit(100);

    const state = await t.state();
    expect(state.entities.find((e) => e.id === minerId)!.cargoUsed).toBe(1);
    expect(state.entities.find((e) => e.id === idleId)!.cargoUsed).toBe(0);
  });

  it('переименование сущности', async () => {
    const t = api(await authToken(app, 'f10'));
    const id = (await t.state()).entities[0]!.id;
    const res = await t.rename(id, 'АРГО');
    expect(res.statusCode).toBe(200);
    expect((await t.state()).entities[0]!.name).toBe('АРГО');

    const bad = await t.rename(id, '   ');
    expect(bad.statusCode).toBe(400);
  });
});
