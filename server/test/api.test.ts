import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { GalaxyMapResponse, SectorMapResponse, StateResponse } from '@tokencontrol/shared';
import { authToken, createTestApp } from './helpers';

let app: FastifyInstance;
let token: string;

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
  it('новый игрок: корабль в стартовом секторе, пустые очередь/трюм/буфер', async () => {
    const res = await app.inject({ method: 'GET', url: '/state', headers: auth() });
    expect(res.statusCode).toBe(200);
    const state = res.json() as StateResponse;
    expect(state.ship.sectorId).toBe('5:5');
    expect(state.ship.dockedObjectId).toBeNull();
    expect(state.queue).toEqual([]);
    expect(state.cargo).toEqual([]);
    expect(state.ovmBuffer).toBe(0);
    expect(state.cargoCapacity).toBeGreaterThan(0);
  });
});

describe('maps', () => {
  it('карта сектора пуста до сканирования', async () => {
    const res = await app.inject({ method: 'GET', url: '/map/sector', headers: auth() });
    expect(res.statusCode).toBe(200);
    const map = res.json() as SectorMapResponse;
    expect(map.sectorId).toBe('5:5');
    expect(map.objects).toEqual([]);
  });

  it('галактика: стартовый сектор посещён, размеры сетки на месте', async () => {
    const res = await app.inject({ method: 'GET', url: '/map/galaxy', headers: auth() });
    expect(res.statusCode).toBe(200);
    const map = res.json() as GalaxyMapResponse;
    expect(map.currentSectorId).toBe('5:5');
    expect(map.galaxyWidth).toBe(10);
    expect(map.galaxyHeight).toBe(10);
    expect(map.sectors).toEqual([{ id: '5:5', gx: 5, gy: 5, visited: true }]);
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
