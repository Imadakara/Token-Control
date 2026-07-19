import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type {
  ChainResponse,
  GalaxyMapResponse,
  OrdersAddResponse,
  OrdersAvailableResponse,
  StateResponse,
} from '@tokencontrol/shared';
import { chainKeys, entities, playerTech } from '../src/db/schema';
import { authToken, createTestApp } from './helpers';

/**
 * Стартовые ограничения, врата, Цепь Миров (ТЗ v0.02 п. 4): игрок заперт в
 * своём секторе, пока не изучит гиперпрыжок и не построит врата; постройка
 * стоит больше ovmBufferCap — накопить можно только в счётчике приказа;
 * Цепь Миров — общий для всех игроков граф секторов.
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
    galaxy: async () =>
      (await app.inject({ method: 'GET', url: '/map/galaxy', headers })).json() as GalaxyMapResponse,
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
    chain: async () => (await app.inject({ method: 'GET', url: '/chain', headers })).json() as ChainResponse,
    connect: (keyId: string) =>
      app.inject({ method: 'POST', url: '/chain/connect', headers, payload: { keyId } }),
    debugKey: async (targetSectorId?: string) =>
      (
        await app.inject({
          method: 'POST',
          url: '/debug/chain-key',
          headers,
          payload: { targetSectorId },
        })
      ).json() as { keyId: string },
  };
}

async function grantHyperjumpTech(pid: string): Promise<void> {
  await app.db
    .insert(playerTech)
    .values({ playerId: pid, techId: 'nav.hyperjump' })
    .onConflictDoNothing();
}

/** /debug/chain-key защищён позывным DEBUG — для чужого игрока сеем строку
 *  напрямую, как player_tech/entities в других тестах этого файла. */
async function grantKey(pid: string, targetSectorId: string | null = null): Promise<string> {
  const [row] = await app.db
    .insert(chainKeys)
    .values({ playerId: pid, targetSectorId, source: 'test' })
    .returning();
  return row!.id;
}

describe('стартовое ограничение: один сектор без технологии и врат', () => {
  it('гиперпрыжок отклоняется уже на постановке приказа', async () => {
    const t = api(await authToken(app, 'g1'));
    const id = (await t.state()).entities[0]!.id;

    const res = await t.order([id], 'jump_hyper', { kind: 'sector', sectorId: '0:0' });
    expect(res.results[0]).toMatchObject({ ok: false, reason: 'ТРЕБУЕТСЯ ТЕХНОЛОГИЯ: ГИПЕРПРЫЖОК' });

    await grantHyperjumpTech('dev:g1');
    // Технология есть, врат всё ещё нет
    const res2 = await t.order([id], 'jump_hyper', { kind: 'sector', sectorId: '0:0' });
    expect(res2.results[0]).toMatchObject({ ok: false, reason: 'НЕТ ВРАТ В СЕКТОРЕ' });
  });
});

describe('постройка врат и авто-подключение к Цепи (ТЗ п. 4)', () => {
  it('стоимость выше ovmBufferCap — накопление только в счётчике приказа; первые врата не к чему подключать', async () => {
    const pid = 'dev:g2';
    const t = api(await authToken(app, 'g2'));
    const lead = (await t.state()).entities[0]!;

    expect(app.cfg.game.actionCosts.build_gate).toBeGreaterThan(app.cfg.game.ovmBufferCap);

    await t.order([lead.id], 'build_gate', { kind: 'point', x: 10, y: 10 });
    // Из буфера постройку не закрыть: прогресс не может превысить cap
    const { applyOvm } = await import('../src/game/queue');
    await app.db.transaction((tx) =>
      applyOvm({ db: tx, cfg: app.cfg, pid }, app.cfg.game.actionCosts.build_gate),
    );

    const state = await t.state();
    const gate = state.entities.find((e) => e.classId === 'gate');
    expect(gate).toBeDefined();
    expect(gate!.x).toBe(10);
    expect(gate!.y).toBe(10);
    expect(gate!.sectorId).toBe(lead.sectorId);

    const { linkedSectorIds } = await import('../src/game/chain');
    expect(await linkedSectorIds(app.db, lead.sectorId)).toEqual([]); // первый узел — не к чему подключаться
  });

  it('вторые врата в другом секторе автоматически подключаются к уже существующим', async () => {
    const pid = 'dev:g3';
    const t = api(await authToken(app, 'g3'));
    const lead = (await t.state()).entities[0]!;

    await t.order([lead.id], 'build_gate', { kind: 'point', x: 0, y: 0 });
    const { applyOvm } = await import('../src/game/queue');
    await app.db.transaction((tx) =>
      applyOvm({ db: tx, cfg: app.cfg, pid }, app.cfg.game.actionCosts.build_gate),
    );

    const { linkedSectorIds, sectorsWithGates } = await import('../src/game/chain');
    const others = await sectorsWithGates(app.db, lead.sectorId);
    expect(others.length).toBeGreaterThan(0); // g2 уже построил свои врата выше
    const linked = await linkedSectorIds(app.db, lead.sectorId);
    expect(linked).toHaveLength(1);
    expect(others).toContain(linked[0]);
  });
});

describe('гиперпрыжок с технологией и вратами — только по рёбрам Цепи', () => {
  it('карта галактики: reachable пуст без техи/врат, заполняется при их наличии', async () => {
    const pid = 'dev:g4';
    const t = api(await authToken(app, 'g4'));
    const lead = (await t.state()).entities[0]!;

    let galaxy = await t.galaxy();
    expect(galaxy.reachable).toEqual([]);
    expect(Array.isArray(galaxy.chainLinks)).toBe(true);

    await grantHyperjumpTech(pid);
    await app.db.insert(entities).values({
      playerId: pid,
      name: 'ВРАТА-Г4',
      classId: 'gate',
      sectorId: lead.sectorId,
      x: 0,
      y: 0,
      modules: [],
      hp: 100,
      hpMax: 100,
    });

    const { linkSectors } = await import('../src/game/chain');
    const { DEFAULT_WORLD, parseSectorId } = await import('../src/game/worldgen');
    const { gx, gy } = parseSectorId(lead.sectorId)!;
    const target = `${(gx + 1) % DEFAULT_WORLD.galaxyWidth}:${gy}`;
    await app.db.transaction((tx) => linkSectors(tx, lead.sectorId, target));

    galaxy = await t.galaxy();
    expect(galaxy.reachable).toEqual([target]);

    const jumpRes = await t.order([lead.id], 'jump_hyper', { kind: 'sector', sectorId: target });
    expect(jumpRes.results[0]).toMatchObject({ ok: true });
  });
});

describe('ключи Цепи Миров — заглушка магазина (ТЗ п. 4, точка монетизации)', () => {
  it('применить ключ нельзя без своих врат в домашнем секторе', async () => {
    const t = api(await authToken(app, 'g5'));
    await t.state();
    const keyId = await grantKey('dev:g5');
    const res = await t.connect(keyId);
    expect(res.statusCode).toBe(409);
    expect((res.json() as { error: string }).error).toBe('НЕТ ВРАТ В ДОМАШНЕМ СЕКТОРЕ');
  });

  it('ключ с конкретной целью подключает домашний сектор именно к ней; повторно не применяется', async () => {
    const pid = 'dev:g6';
    const t = api(await authToken(app, 'g6'));
    const lead = (await t.state()).entities[0]!;

    await app.db.insert(entities).values({
      playerId: pid,
      name: 'ВРАТА-Г6',
      classId: 'gate',
      sectorId: lead.sectorId,
      x: 0,
      y: 0,
      modules: [],
      hp: 100,
      hpMax: 100,
    });

    const { DEFAULT_WORLD, parseSectorId } = await import('../src/game/worldgen');
    const { gx, gy } = parseSectorId(lead.sectorId)!;
    const target = `${(gx + 3) % DEFAULT_WORLD.galaxyWidth}:${(gy + 2) % DEFAULT_WORLD.galaxyHeight}`;
    const keyId = await grantKey(pid, target);

    const before = await t.chain();
    expect(before.keys.find((k) => k.id === keyId)).toMatchObject({
      targetSectorId: target,
      consumedAt: null,
    });

    const res = await t.connect(keyId);
    expect(res.statusCode).toBe(200);

    const { linkedSectorIds } = await import('../src/game/chain');
    expect(await linkedSectorIds(app.db, lead.sectorId)).toContain(target);

    const after = await t.chain();
    expect(after.keys.find((k) => k.id === keyId)!.consumedAt).not.toBeNull();

    const again = await t.connect(keyId);
    expect(again.statusCode).toBe(409);
    expect((again.json() as { error: string }).error).toBe('КЛЮЧ УЖЕ ИСПОЛЬЗОВАН');
  });

  it('выдача ключей — только капитану DEBUG, как и остальные дебаг-команды', async () => {
    const t = api(await authToken(app, 'g7'));
    const denied = await app.inject({
      method: 'POST',
      url: '/debug/chain-key',
      headers: t.headers,
      payload: {},
    });
    expect(denied.statusCode).toBe(403);

    const debug = api(await authToken(app, 'DEBUG'));
    const { keyId } = await debug.debugKey();
    expect(keyId).toBeTruthy();
    expect((await debug.chain()).keys.map((k) => k.id)).toContain(keyId);
  });
});
