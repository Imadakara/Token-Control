import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type {
  KnowledgeResponse,
  OrdersAddResponse,
  OrdersAvailableResponse,
  StateResponse,
  TechResponse,
} from '@tokencontrol/shared';
import { objects } from '../src/db/schema';
import { authToken, createTestApp } from './helpers';

/**
 * База Знаний и Технологии (ТЗ v0.02 пп. 5–6): полный цикл подобранный
 * data-core → upload_data → запись открыта → технология исследуема →
 * исследование разблокирует Capability (def.weapons → приказ attack).
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
    knowledge: async () =>
      (await app.inject({ method: 'GET', url: '/knowledge', headers })).json() as KnowledgeResponse,
    tech: async () => (await app.inject({ method: 'GET', url: '/tech', headers })).json() as TechResponse,
    research: (techId: string) =>
      app.inject({ method: 'POST', url: '/tech/research', headers, payload: { techId } }),
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

/** data-core c заданной записью — не зависим от случайного выбора worldgen. */
async function spawnDataCore(sectorId: string, x: number, y: number, entryId: string): Promise<string> {
  const [row] = await app.db
    .insert(objects)
    .values({
      sectorId,
      x,
      y,
      type: 'container',
      props: { contents: 'data-core', entryId },
      resourceType: null,
      resourceAmount: null,
      maxResource: null,
    })
    .returning();
  return row!.id;
}

describe('база знаний: свежий игрок', () => {
  it('ничего не открыто, ни одна технология не исследуема без данных', async () => {
    const t = api(await authToken(app, 'k1'));
    expect((await t.knowledge()).entries).toEqual([]);

    const { techs } = await t.tech();
    expect(techs).toHaveLength(5);
    expect(techs.every((tech) => !tech.researched)).toBe(true);
    expect(techs.every((tech) => !tech.researchable)).toBe(true);
    const weapons = techs.find((tech) => tech.id === 'def.weapons')!;
    expect(weapons.missingEntries).toEqual(['def.ballistics']);
  });
});

describe('загрузка данных и исследование (ТЗ v0.02 пп. 5–6)', () => {
  it('подобранный data-core открывает запись; технология становится исследуемой и разблокирует приказ', async () => {
    const t = api(await authToken(app, 'k2'));
    const lead = (await t.state()).entities[0]!;
    const coreId = await spawnDataCore(lead.sectorId, lead.x, lead.y, 'def.ballistics');

    // Рельсотрон у scout_mk1 есть из коробки — но без технологии приказ
    // недоступен ИМЕННО по ней, гейт по возможностям проверяется раньше
    // поиска целей (game/orders.ts).
    const before = await t.available(lead.id);
    const attackBefore = before.entities[0]!.orders.find((o) => o.action === 'attack')!;
    expect(attackBefore).toMatchObject({
      available: false,
      reason: 'ТРЕБУЕТСЯ ТЕХНОЛОГИЯ: ВООРУЖЕНИЕ',
    });

    await t.order([lead.id], 'pickup', { kind: 'object', objectId: coreId });
    await t.submit(10);
    await t.order([lead.id], 'upload_data');
    await t.submit(50);

    const know = await t.knowledge();
    expect(know.entries.map((e) => e.id)).toEqual(['def.ballistics']);

    let techs = (await t.tech()).techs;
    const weapons = techs.find((tech) => tech.id === 'def.weapons')!;
    expect(weapons.missingEntries).toEqual([]);
    expect(weapons.researchable).toBe(false); // хватает данных, не хватает ОВМ (буфер 0)

    // Прямое пополнение буфера мимо лимита анти-абуза (10+50 ОВМ уже съели
    // часть минутной квоты выше) — тот же приём, что и «кап буфера» в
    // queue.test.ts: dataCost.ovm def.weapons = 500.
    const { applyOvm } = await import('../src/game/queue');
    await app.db.transaction((tx) => applyOvm({ db: tx, cfg: app.cfg, pid: 'dev:k2' }, 500));
    techs = (await t.tech()).techs;
    expect(techs.find((tech) => tech.id === 'def.weapons')!.researchable).toBe(true);

    const res = await t.research('def.weapons');
    expect(res.statusCode).toBe(200);
    techs = (await t.tech()).techs;
    expect(techs.find((tech) => tech.id === 'def.weapons')!.researched).toBe(true);

    // Модуль был готов с самого начала — не хватало только технологии;
    // добавляем реальную цель, чтобы «доступно» было по существу, а не
    // случайно совпало с отсутствием кандидатов
    const targetId = (
      await app.db
        .insert(objects)
        .values({
          sectorId: lead.sectorId,
          x: lead.x,
          y: lead.y,
          type: 'asteroid',
          props: { ore: 'ferrum', attackable: true, hp: 5 },
          resourceType: 'ferrum',
          resourceAmount: 5,
          maxResource: 5,
        })
        .returning()
    )[0]!.id;
    await t.order([lead.id], 'scan');
    await t.submit(10);

    const after = await t.available(lead.id);
    const attackAfter = after.entities[0]!.orders.find((o) => o.action === 'attack')!;
    expect(attackAfter.available).toBe(true);
    expect(attackAfter.candidates?.some((c) => c.objectId === targetId)).toBe(true);

    // Повторное исследование отклоняется
    const again = await t.research('def.weapons');
    expect(again.statusCode).toBe(409);
  });

  it('исследование без нужных данных или ОВМ отклоняется с внятной причиной', async () => {
    const t = api(await authToken(app, 'k3'));
    await t.state();

    const noData = await t.research('def.weapons');
    expect(noData.statusCode).toBe(409);
    expect((noData.json() as { error: string }).error).toBe('НЕДОСТАТОЧНО ДАННЫХ В БАЗЕ ЗНАНИЙ');
  });

  it('цепочка requires: вторая ступень ветки недоступна без первой', async () => {
    const t = api(await authToken(app, 'k4'));
    const res = await t.research('nav.hyperjump');
    expect(res.statusCode).toBe(409);
    expect((res.json() as { error: string }).error).toContain('ТРЕБУЕТСЯ');
  });

  it('неизвестная технология отклоняется', async () => {
    const t = api(await authToken(app, 'k5'));
    const res = await t.research('no.such.tech');
    expect(res.statusCode).toBe(409);
  });
});
