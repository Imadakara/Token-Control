import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type {
  OrdersAddResponse,
  OrdersAvailableResponse,
  SectorMapResponse,
  StateResponse,
} from '@tokencontrol/shared';
import { eq } from 'drizzle-orm';
import { objects } from '../src/db/schema';
import { authToken, createTestApp } from './helpers';

/**
 * Фаза 9 (ТЗ v0.02 п. 3.2): модульные ограничения, «Взаимодействие»
 * (стыковка+расстыковка одним приказом) и минимальная боёвка.
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
    available: async (entityId: string) =>
      (
        await app.inject({ method: 'GET', url: `/orders/available?entityId=${entityId}`, headers })
      ).json() as OrdersAvailableResponse,
    order: async (entityIds: string[], action: string, params: unknown = null) =>
      (
        await app.inject({
          method: 'POST',
          url: '/orders/add',
          headers,
          payload: { entityIds, action, params },
        })
      ).json() as OrdersAddResponse,
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

/** Строка objects, вставленная напрямую — не зависим от случайной генерации сектора. */
async function spawnObject(
  sectorId: string,
  x: number,
  y: number,
  overrides: Partial<typeof objects.$inferInsert>,
): Promise<string> {
  const [row] = await app.db
    .insert(objects)
    .values({
      sectorId,
      x,
      y,
      type: 'phenomenon',
      props: {},
      resourceType: null,
      resourceAmount: null,
      maxResource: null,
      ...overrides,
    })
    .returning();
  return row!.id;
}

describe('модульные ограничения (ТЗ v0.02 п. 3.2)', () => {
  it('без бурового модуля ДОБЫЧА недоступна с причиной «НЕТ МОДУЛЯ»; с модулем — доступна', async () => {
    const pid = 'dev:c1';
    const t = api(await authToken(app, 'c1'));
    const { createEntity, leadEntity } = await import('../src/game/entities');
    const lead = (await leadEntity(app.db, pid))!;
    // hauler_mk1 по каталогу без модулей вообще
    const hauler = await createEntity(app.db, pid, 'hauler_mk1', lead.sectorId, lead.x, lead.y);

    await spawnObject(lead.sectorId, lead.x, lead.y, {
      type: 'asteroid',
      resourceType: 'ferrum',
      resourceAmount: 5,
      maxResource: 5,
      props: { ore: 'ferrum' },
    });
    // Кандидатов ищем среди известного игроку — просканируем ведущей сущностью
    await t.order([lead.id], 'scan');
    await t.submit(10);

    const haulerOrders = await t.available(hauler.id);
    const mineOpt = haulerOrders.entities[0]!.orders.find((o) => o.action === 'mine')!;
    expect(mineOpt).toMatchObject({ available: false, reason: 'НЕТ МОДУЛЯ' });

    const denied = await t.order([hauler.id], 'mine', {
      kind: 'object',
      objectId: (await t.sectorMap()).objects.find((o) => o.type === 'asteroid')!.id,
    });
    expect(denied.results[0]).toMatchObject({ ok: false, reason: 'НЕТ МОДУЛЯ' });

    // scout_mk1 (ведущая сущность игрока) буровой лазер имеет из коробки
    const leadOrders = await t.available(lead.id);
    const leadMine = leadOrders.entities[0]!.orders.find((o) => o.action === 'mine')!;
    expect(leadMine.available).toBe(true);
  });

  it('без модуля вооружения АТАКА недоступна с причиной «НЕТ МОДУЛЯ ВООРУЖЕНИЯ»', async () => {
    const pid = 'dev:c2';
    const t = api(await authToken(app, 'c2'));
    const { createEntity, leadEntity } = await import('../src/game/entities');
    const lead = (await leadEntity(app.db, pid))!;
    const hauler = await createEntity(app.db, pid, 'hauler_mk1', lead.sectorId, lead.x, lead.y);

    const { entities } = await t.available(hauler.id);
    const attackOpt = entities[0]!.orders.find((o) => o.action === 'attack')!;
    expect(attackOpt).toMatchObject({ available: false, reason: 'НЕТ МОДУЛЯ ВООРУЖЕНИЯ' });
  });
});

describe('взаимодействие: стыковка и расстыковка одним приказом', () => {
  it('interact стыкует к ближайшему dockable-объекту, повторный interact расстыковывает', async () => {
    const t = api(await authToken(app, 'c3'));
    const lead = (await t.state()).entities[0]!;
    const dockId = await spawnObject(lead.sectorId, lead.x, lead.y, {
      type: 'station',
      props: { name: 'TEST-DOCK', dockable: true },
    });

    await t.order([lead.id], 'interact');
    await t.submit(10);
    let state = await t.state();
    expect(state.entities[0]!.dockedObjectId).toBe(dockId);
    expect(state.entities[0]!.status).toBe('docked');

    await t.order([lead.id], 'interact');
    await t.submit(10);
    state = await t.state();
    expect(state.entities[0]!.dockedObjectId).toBeNull();
  });

  it('без цели рядом interact недоступен; расстыковка доступна всегда', async () => {
    const t = api(await authToken(app, 'c4'));
    const id = (await t.state()).entities[0]!.id;
    const { entities } = await t.available(id);
    const interact = entities[0]!.orders.find((o) => o.action === 'interact')!;
    expect(interact.available).toBe(false);
  });
});

describe('минимальная боёвка (ТЗ v0.02 п. 3.2)', () => {
  it('атака снижает HP цели, уничтожение роняет контейнер, который можно подобрать', async () => {
    const t = api(await authToken(app, 'c5'));
    const lead = (await t.state()).entities[0]!;
    // scout_mk1 несёт railgun (damage:3) по умолчанию — см. shared/entities.ts
    const targetId = await spawnObject(lead.sectorId, lead.x, lead.y, {
      type: 'asteroid',
      props: { ore: 'ferrum', attackable: true, hp: 5 },
      resourceType: 'ferrum',
      resourceAmount: 5,
      maxResource: 5,
    });

    // Первая атака: 5 - 3 = 2, цель ещё жива
    await t.order([lead.id], 'attack', { kind: 'object', objectId: targetId });
    await t.submit(100);
    const [afterFirst] = await app.db.select().from(objects).where(eq(objects.id, targetId));
    expect(afterFirst).toBeDefined();
    expect((afterFirst!.props as { hp: number }).hp).toBe(2);

    // Вторая атака: 2 - 3 ≤ 0 — уничтожена, контейнер на тех же координатах
    await t.order([lead.id], 'attack', { kind: 'object', objectId: targetId });
    await t.submit(100);
    const [gone] = await app.db.select().from(objects).where(eq(objects.id, targetId));
    expect(gone).toBeUndefined();

    // Контейнер — не открытый игроку объект, пока не просканирован
    await t.order([lead.id], 'scan');
    await t.submit(10);
    const map = await t.sectorMap();
    const loot = map.objects.find(
      (o) => o.type === 'container' && o.x === lead.x && o.y === lead.y,
    )!;
    expect(loot).toBeDefined();

    const pickup = await t.order([lead.id], 'pickup', { kind: 'object', objectId: loot.id });
    expect(pickup.results[0]).toMatchObject({ ok: true });
  });

  it('неуязвимую цель (станцию) атаковать нельзя', async () => {
    const t = api(await authToken(app, 'c6'));
    const lead = (await t.state()).entities[0]!;
    const stationId = await spawnObject(lead.sectorId, lead.x, lead.y, {
      type: 'station',
      props: { name: 'INVULN', dockable: true },
    });

    const res = await t.order([lead.id], 'attack', { kind: 'object', objectId: stationId });
    expect(res.results[0]).toMatchObject({ ok: false, reason: 'ЦЕЛЬ НЕУЯЗВИМА' });
  });
});
