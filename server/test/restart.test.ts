import { describe, expect, it } from 'vitest';
import type {
  ChainResponse,
  CreditsSubmitResponse,
  GalaxyMapResponse,
  KnowledgeResponse,
  StateResponse,
} from '@tokencontrol/shared';
import { buildApp } from '../src/app';
import { chainKeys, playerKnowledge, playerTech } from '../src/db/schema';
import { linkSectors } from '../src/game/chain';
import { applyOvm } from '../src/game/queue';
import { authToken, createTestApp, TEST_DATABASE_URL } from './helpers';

/**
 * Переживание рестартов (Strategy - Plan.md, Фаза 13, критерий: kill/restart
 * сервера посреди приказа любой сущности — ничего не потеряно и не задвоено).
 * Сервер не хранит игровое состояние в памяти процесса (ТЗ п. 11, см. также
 * MVP - Implementation.md, Фаза 5) — единственный способ реально это
 * проверить, а не просто перечитать код, — закрыть один процесс-приложение и
 * поднять второй поверх ТОЙ ЖЕ БД, включая таблицы фаз 6–12 (entities,
 * queues-по-сущностям, player_knowledge/player_tech, sector_links, chain_keys),
 * которых не было при последней проверке этого критерия (MVP, фаза 5).
 */

function api(app: Awaited<ReturnType<typeof buildApp>>, token: string) {
  const headers = { authorization: `Bearer ${token}` };
  return {
    state: async () =>
      (await app.inject({ method: 'GET', url: '/state', headers })).json() as StateResponse,
    knowledge: async () =>
      (await app.inject({ method: 'GET', url: '/knowledge', headers })).json() as KnowledgeResponse,
    galaxy: async () =>
      (await app.inject({ method: 'GET', url: '/map/galaxy', headers })).json() as GalaxyMapResponse,
    chain: async () => (await app.inject({ method: 'GET', url: '/chain', headers })).json() as ChainResponse,
    submit: (packetSeq: number, ovm: number) =>
      app.inject({
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
      }),
    order: (entityId: string, action: string, params: unknown = null) =>
      app.inject({
        method: 'POST',
        url: '/orders/add',
        headers,
        payload: { entityIds: [entityId], action, params },
      }),
  };
}

describe('переживание рестартов сервера (таблицы фаз 6–12)', () => {
  it('приказ посреди выполнения, знания, технологии и Цепь Миров переживают закрытие и переоткрытие процесса', async () => {
    const pid = 'dev:restart1';
    const app1 = await createTestApp();
    const token = await authToken(app1, 'restart1');
    const t1 = api(app1, token);

    const lead = (await t1.state()).entities[0]!;

    // Приказ «посреди выполнения»: стоимость 100 (move), внесено только 37 —
    // ни довершён, ни потерян, если рестарт застанет его ровно в этой точке.
    await t1.order(lead.id, 'move', { kind: 'point', x: 5, y: 5 });
    await app1.db.transaction((tx) => applyOvm({ db: tx, cfg: app1.cfg, pid }, 37));

    // Данные фаз 6–12: открытая запись БЗ, изученная технология, ребро Цепи Миров.
    await app1.db.insert(playerKnowledge).values({ playerId: pid, entryId: 'def.ballistics' });
    await app1.db.insert(playerTech).values({ playerId: pid, techId: 'def.weapons' });
    await app1.db.transaction((tx) => linkSectors(tx, lead.sectorId, '9:9'));
    const [key] = await app1.db
      .insert(chainKeys)
      .values({ playerId: pid, targetSectorId: null, source: 'test' })
      .returning();

    // Пакет с packetSeq=777, ещё не подтверждённый вторым разом — как будто
    // коннектор отправил его, но не успел получить ack до рестарта.
    const firstSubmit = await t1.submit(777, 50);
    expect(firstSubmit.statusCode).toBe(200);

    const before = await t1.state();
    expect(before.entities[0]!.orders[0]).toMatchObject({
      action: 'move',
      costOvm: 100,
      progressOvm: expect.closeTo(87, 1), // 37 (buffer) + 50 (пакет)
      status: 'active',
    });
    const bufferBefore = before.ovmBuffer;

    // «Убиваем» процесс: закрываем приложение (пул соединений, вотчеры) —
    // ничего, кроме БД, не должно быть источником истины.
    await app1.close();

    // «Перезапускаем»: новый процесс поверх ТОЙ ЖЕ БД, без пересоздания.
    const app2 = await buildApp({ databaseUrl: TEST_DATABASE_URL, logger: false });
    try {
      const token2 = await authToken(app2, 'restart1'); // тот же playerId — не новый игрок
      const t2 = api(app2, token2);

      const after = await t2.state();
      expect(after.entities[0]!.id).toBe(before.entities[0]!.id);
      expect(after.entities[0]!.orders).toEqual(before.entities[0]!.orders); // ни потери, ни довершения
      expect(after.ovmBuffer).toBe(bufferBefore);

      expect((await t2.knowledge()).entries.map((e) => e.id)).toEqual(['def.ballistics']);
      const galaxy = await t2.galaxy();
      const hasLink = galaxy.chainLinks.some(
        (l) =>
          (l.a === lead.sectorId && l.b === '9:9') || (l.a === '9:9' && l.b === lead.sectorId),
      );
      expect(hasLink).toBe(true); // порядок (a,b) канонизирован по строкам — не гадаем, в какую сторону
      expect((await t2.chain()).keys.map((k) => k.id)).toContain(key!.id);

      // Повтор ТОГО ЖЕ пакета после «рестарта» — идемпотентность не должна
      // сломаться сменой процесса: ответ эхом повторяет прежний accepted
      // (game/credits.ts), но буфер не должен вырасти ещё раз.
      const dup = await t2.submit(777, 50);
      expect(dup.statusCode).toBe(200);
      expect((dup.json() as CreditsSubmitResponse).accepted).toBe(50);
      expect((await t2.state()).ovmBuffer).toBe(bufferBefore);
    } finally {
      await app2.close();
    }
  });
});
