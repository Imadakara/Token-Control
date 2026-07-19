import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { GalaxyMapResponse, SectorMapResponse, StateResponse } from '@tokencontrol/shared';
import { authToken, createTestApp } from './helpers';
import { DEFAULT_WORLD, pickHomeSector } from '../src/game/worldgen';

let app: FastifyInstance;
let token: string;

/** Каждый игрок стартует в своём домашнем секторе (ТЗ v0.02 п. 4). */
const HOME = pickHomeSector('dev:tester', DEFAULT_WORLD);

beforeAll(async () => {
  app = await createTestApp();
  token = await authToken(app);
}, 30_000);

afterAll(async () => {
  await app.close();
});

const auth = () => ({ authorization: `Bearer ${token}` });

describe('auth', () => {
  it('отклоняет мусорный playerId', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/dev',
      payload: { playerId: 'нет пробелам!' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('повторный вход того же игрока не создаёт дубликатов', async () => {
    const again = await authToken(app);
    expect(typeof again).toBe('string');
  });

  it('запросы без токена отклоняются', async () => {
    const res = await app.inject({ method: 'GET', url: '/state' });
    expect(res.statusCode).toBe(401);
  });
});

describe('state', () => {
  it('новый игрок: одна сущность в домашнем секторе, пустые приказы/трюм/буфер', async () => {
    const res = await app.inject({ method: 'GET', url: '/state', headers: auth() });
    expect(res.statusCode).toBe(200);
    const state = res.json() as StateResponse;
    expect(state.entities).toHaveLength(1);
    const [e] = state.entities;
    expect(e!.sectorId).toBe(HOME);
    expect(e!.classId).toBe('scout_mk1');
    expect(e!.name).toBe('БОРТ-001');
    expect(e!.status).toBe('idle');
    expect(e!.orders).toEqual([]);
    expect(e!.cargoUsed).toBe(0);
    expect(e!.hp).toBe(e!.hpMax);
    expect(e!.cargo).toEqual([]);
    expect(e!.cargoCapacity).toBeGreaterThan(0);
    expect(state.ovmBuffer).toBe(0);
  });
});

describe('maps', () => {
  it('карта сектора пуста до сканирования', async () => {
    const res = await app.inject({ method: 'GET', url: '/map/sector', headers: auth() });
    expect(res.statusCode).toBe(200);
    const map = res.json() as SectorMapResponse;
    expect(map.sectorId).toBe(HOME);
    expect(map.objects).toEqual([]);
  });

  it('галактика: домашний сектор посещён, размеры сетки на месте', async () => {
    const res = await app.inject({ method: 'GET', url: '/map/galaxy', headers: auth() });
    expect(res.statusCode).toBe(200);
    const map = res.json() as GalaxyMapResponse;
    expect(map.currentSectorId).toBe(HOME);
    expect(map.galaxyWidth).toBe(DEFAULT_WORLD.galaxyWidth);
    expect(map.galaxyHeight).toBe(DEFAULT_WORLD.galaxyHeight);
    expect(map.sectors).toEqual([
      { id: HOME, gx: Number(HOME.split(':')[0]), gy: Number(HOME.split(':')[1]), visited: true },
    ]);
  });
});

describe('debug', () => {
  it('дебаг-начисление доступно только капитану DEBUG', async () => {
    const forbidden = await app.inject({
      method: 'POST',
      url: '/debug/credit',
      headers: auth(), // обычный игрок tester
      payload: { ovm: 1000 },
    });
    expect(forbidden.statusCode).toBe(403);

    const debugToken = await authToken(app, 'DEBUG');
    const res = await app.inject({
      method: 'POST',
      url: '/debug/credit',
      headers: { authorization: `Bearer ${debugToken}` },
      payload: { ovm: 1000 },
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as StateResponse).ovmBuffer).toBe(1000);
  });
});

describe('config', () => {
  it('отдаёт игровой конфиг со стоимостями действий', async () => {
    const res = await app.inject({ method: 'GET', url: '/config' });
    expect(res.statusCode).toBe(200);
    const cfg = res.json() as { actionCosts: Record<string, number> };
    expect(cfg.actionCosts.scan).toBe(10);
    expect(cfg.actionCosts.jump_hyper).toBe(1000);
  });
});
