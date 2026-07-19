import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { AssistantPrepareResponse, StateResponse } from '@tokencontrol/shared';
import { playerKnowledge } from '../src/db/schema';
import { applyOvm } from '../src/game/queue';
import { authToken, createTestApp } from './helpers';

/**
 * ИИ-ассистент (ТЗ v0.02 п. 7): единственный серверный контракт — списание
 * assistantCostOvm и выдача только реально открытых игроком записей Базы
 * Знаний. Сам разговор с моделью сервер не видит — тестируется отдельно на
 * клиенте (нет client-side тестовой инфраструктуры в проекте, живая проверка
 * в браузере).
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
    prepare: () => app.inject({ method: 'POST', url: '/assistant/prepare', headers }),
  };
}

describe('ассистент: списание ОВМ и выдача контекста (ТЗ v0.02 п. 7)', () => {
  it('без ОВМ в буфере — 409, ничего не списано', async () => {
    const t = api(await authToken(app, 'a1'));
    await t.state();

    const res = await t.prepare();
    expect(res.statusCode).toBe(409);
    expect((res.json() as { error: string }).error).toBe('НЕДОСТАТОЧНО ОВМ');

    expect((await t.state()).ovmBuffer).toBe(0);
  });

  it('списывает assistantCostOvm и отдаёт только открытые игроком записи', async () => {
    const pid = 'dev:a2';
    const t = api(await authToken(app, 'a2'));
    await t.state();

    await app.db
      .insert(playerKnowledge)
      .values({ playerId: pid, entryId: 'def.ballistics' })
      .onConflictDoNothing();
    const cost = app.cfg.game.assistantCostOvm;
    await app.db.transaction((tx) => applyOvm({ db: tx, cfg: app.cfg, pid }, cost + 1000));

    const before = (await t.state()).ovmBuffer;
    const res = await t.prepare();
    expect(res.statusCode).toBe(200);
    const body = res.json() as AssistantPrepareResponse;
    expect(body.entries.map((e) => e.id)).toEqual(['def.ballistics']);
    expect(body.systemPrompt.length).toBeGreaterThan(0);
    expect(body.ovmBuffer).toBe(before - cost);

    expect((await t.state()).ovmBuffer).toBe(before - cost);
  });

  it('каждый вызов списывает заново — это не одноразовая покупка', async () => {
    const pid = 'dev:a3';
    const t = api(await authToken(app, 'a3'));
    await t.state();

    const cost = app.cfg.game.assistantCostOvm;
    await app.db.transaction((tx) => applyOvm({ db: tx, cfg: app.cfg, pid }, cost * 2));

    const first = await t.prepare();
    expect(first.statusCode).toBe(200);
    expect((first.json() as AssistantPrepareResponse).ovmBuffer).toBe(cost);

    const second = await t.prepare();
    expect(second.statusCode).toBe(200);
    expect((second.json() as AssistantPrepareResponse).ovmBuffer).toBe(0);

    const third = await t.prepare();
    expect(third.statusCode).toBe(409);
  });
});
