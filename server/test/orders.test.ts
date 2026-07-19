import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type {
  OrdersAvailableResponse,
  SectorMapResponse,
  StateResponse,
} from '@tokencontrol/shared';
import { authToken, createTestApp } from './helpers';

/**
 * Список доступных приказов (ТЗ v0.02 п. 3.1): построен поверх validateAction,
 * поэтому ключевой инвариант каждого теста — то, что помечено available:true,
 * реально проходит через POST /orders/add.
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
    sectorMap: async () =>
      (await app.inject({ method: 'GET', url: '/map/sector', headers })).json() as SectorMapResponse,
    available: async (entityId?: string) =>
      (
        await app.inject({
          method: 'GET',
          url: `/orders/available${entityId ? `?entityId=${entityId}` : ''}`,
          headers,
        })
      ).json() as OrdersAvailableResponse,
    availableRaw: (entityId?: string) =>
      app.inject({
        method: 'GET',
        url: `/orders/available${entityId ? `?entityId=${entityId}` : ''}`,
        headers,
      }),
    order: async (entityIds: string[], action: string, params: unknown = null) =>
      app.inject({
        method: 'POST',
        url: '/orders/add',
        headers,
        payload: { entityIds, action, params },
      }),
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

describe('доступные приказы', () => {
  it('свежая сущность: подвижные приказы доступны, целевые — нет (нечего сканировать)', async () => {
    const t = api(await authToken(app, 'o1'));
    const id = (await t.state()).entities[0]!.id;
    const { entities } = await t.available(id);
    expect(entities).toHaveLength(1);
    const byAction = Object.fromEntries(entities[0]!.orders.map((o) => [o.action, o]));

    expect(byAction.scan).toMatchObject({ available: true, target: 'none' });
    expect(byAction.jump_local).toMatchObject({ available: true, target: 'point' });
    expect(byAction.jump_hyper).toMatchObject({ available: true, target: 'sector' });
    // Ничего не просканировано — целям неоткуда взяться
    expect(byAction.analyze).toMatchObject({ available: false, target: 'object', candidates: [] });
    expect(byAction.mine.available).toBe(false);
    expect(byAction.pickup.available).toBe(false);
    expect(typeof byAction.analyze.reason).toBe('string');
  });

  it('после сканирования и подлёта к астероиду — ДОБЫЧА доступна с кандидатом', async () => {
    const t = api(await authToken(app, 'o2'));
    const id = (await t.state()).entities[0]!.id;
    await t.order([id], 'scan');
    await t.submit(10);
    const asteroid = (await t.sectorMap()).objects.find((o) => o.type === 'asteroid')!;

    await t.order([id], 'jump_local', { kind: 'object', objectId: asteroid.id });
    await t.submit(100);

    const { entities } = await t.available(id);
    const mine = entities[0]!.orders.find((o) => o.action === 'mine')!;
    expect(mine.available).toBe(true);
    expect(mine.candidates?.some((c) => c.objectId === asteroid.id)).toBe(true);

    // Инвариант: то, что предложено доступным, реально проходит постановку
    const res = await t.order([id], 'mine', { kind: 'object', objectId: asteroid.id });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { results: { ok: boolean }[] };
    expect(body.results[0]!.ok).toBe(true);
  });

  it('полная очередь: все приказы недоступны с причиной «ОЧЕРЕДЬ ЗАПОЛНЕНА»', async () => {
    const t = api(await authToken(app, 'o3'));
    const id = (await t.state()).entities[0]!.id;
    // orderSlots по умолчанию 3 — заполняем тремя прыжками
    await t.order([id], 'jump_local', { kind: 'point', x: 1, y: 1 });
    await t.order([id], 'jump_local', { kind: 'point', x: 2, y: 2 });
    await t.order([id], 'jump_local', { kind: 'point', x: 3, y: 3 });

    const { entities } = await t.available(id);
    expect(entities[0]!.orders.every((o) => !o.available)).toBe(true);
    expect(entities[0]!.orders.every((o) => o.reason === 'ОЧЕРЕДЬ ЗАПОЛНЕНА')).toBe(true);

    const res = await t.order([id], 'scan');
    const body = res.json() as { results: { ok: boolean; reason?: string }[] };
    expect(body.results[0]).toMatchObject({ ok: false, reason: 'ОЧЕРЕДЬ ЗАПОЛНЕНА' });
  });

  it('неподвижная сущность: перемещение недоступно, остальное — как обычно', async () => {
    const pid = 'dev:o4';
    const t = api(await authToken(app, 'o4'));
    const { createEntity, leadEntity } = await import('../src/game/entities');
    const lead = (await leadEntity(app.db, pid))!;
    const gate = await createEntity(app.db, pid, 'gate', lead.sectorId, lead.x, lead.y);

    const { entities } = await t.available(gate.id);
    const byAction = Object.fromEntries(entities[0]!.orders.map((o) => [o.action, o]));
    expect(byAction.jump_local).toMatchObject({ available: false, reason: 'СУЩНОСТЬ НЕПОДВИЖНА' });
    expect(byAction.jump_hyper).toMatchObject({ available: false, reason: 'СУЩНОСТЬ НЕПОДВИЖНА' });
    expect(byAction.scan.available).toBe(true);
  });

  it('?entityId= фильтрует до одной сущности; чужая/несуществующая — 404', async () => {
    const t1 = api(await authToken(app, 'o5'));
    const t2 = api(await authToken(app, 'o6'));
    const id1 = (await t1.state()).entities[0]!.id;
    const id2 = (await t2.state()).entities[0]!.id;

    const only = await t1.available(id1);
    expect(only.entities).toHaveLength(1);
    expect(only.entities[0]!.entityId).toBe(id1);

    const alien = await t1.availableRaw(id2);
    expect(alien.statusCode).toBe(404);

    const missing = await t1.availableRaw('00000000-0000-0000-0000-000000000000');
    expect(missing.statusCode).toBe(404);
  });

  it('без entityId — доступные приказы по всему флоту', async () => {
    const pid = 'dev:o7';
    const t = api(await authToken(app, 'o7'));
    const { createEntity, leadEntity } = await import('../src/game/entities');
    const lead = (await leadEntity(app.db, pid))!;
    const second = await createEntity(app.db, pid, 'hauler_mk1', lead.sectorId, lead.x, lead.y);

    const { entities } = await t.available();
    expect(entities.map((e) => e.entityId).sort()).toEqual([lead.id, second.id].sort());
  });
});
