import type { ActionParams, ActionType } from '@tokencontrol/shared';
import { and, eq, sql } from 'drizzle-orm';
import { cargo, entities, knownObjects, objects } from '../db/schema';
import type { ServerConfig } from './config';
import { entityClass, hasModuleGranting, totalDamage, type EntityRow } from './entities';
import { cargoUsed, type DbLike } from './state';
import { ensureSectorGenerated, markVisited } from './world';
import { sectorExists, sectorsAdjacent } from './worldgen';

/**
 * Условия применимости и результаты действий (ТЗ п. 6, ТЗ v0.02 п. 3.2).
 * validate вызывается на постановке и на старте выполнения; execute — при
 * завершении (набран счётчик ОВМ). Всё выполняется внутри транзакции.
 *
 * Исполнитель передаётся явным аргументом `entity`: приказы отдаются сущностям
 * флота, а не «кораблю игрока» (ТЗ v0.02 п. 3).
 */

export interface ActionCtx {
  db: DbLike;
  cfg: ServerConfig;
  pid: string;
  /** Сток событий завершения/пропуска; маршруты пушат их в WS после коммита. */
  events?: { action: string; result: string }[];
}

export type Validation = { ok: true } | { ok: false; reason: string };

type ObjectRow = typeof objects.$inferSelect;

async function getObject(ctx: ActionCtx, objectId: string): Promise<ObjectRow | null> {
  const [obj] = await ctx.db.select().from(objects).where(eq(objects.id, objectId));
  return obj ?? null;
}

function isNear(entity: EntityRow, obj: ObjectRow, cfg: ServerConfig): boolean {
  if (obj.sectorId !== entity.sectorId) return false;
  return Math.hypot(entity.x - obj.x, entity.y - obj.y) <= cfg.game.nearDistance;
}

function isAttackable(obj: ObjectRow): boolean {
  return !!(obj.props as Record<string, unknown>).attackable;
}

async function nearObjectFromParams(
  ctx: ActionCtx,
  entity: EntityRow,
  params: ActionParams | null,
): Promise<{ obj: ObjectRow } | { reason: string }> {
  if (!params || params.kind !== 'object') return { reason: 'НЕ УКАЗАНА ЦЕЛЬ' };
  const obj = await getObject(ctx, params.objectId);
  if (!obj) return { reason: 'ОБЪЕКТ НЕ СУЩЕСТВУЕТ' };
  if (!isNear(entity, obj, ctx.cfg)) return { reason: 'СУЩНОСТЬ НЕ ВОЗЛЕ ОБЪЕКТА' };
  return { obj };
}

/** Свободное место в трюме конкретной сущности. */
async function cargoFull(ctx: ActionCtx, entity: EntityRow): Promise<boolean> {
  const used = await cargoUsed(ctx.db, entity.id);
  return used >= entityClass(entity).cargoCapacity;
}

/**
 * Режимы валидации (ТЗ п. 5, ТЗ v0.02 п. 3.1):
 * - enqueue: постановка в очередь. Проверяются только статические условия
 *   (цель существует, параметры корректны) — позиционные условия («возле»)
 *   выполнит предыдущая задача очереди (прыжок → анализ).
 * - activate: старт выполнения. Полная проверка; провал → «НЕВЫПОЛНИМО».
 * - offer: «показать в списке доступных приказов» (game/orders.ts), когда
 *   конкретной цели ещё нет — игрок только выбирает приказ, точку/сектор
 *   назовёт следующим шагом на карте. Отличается от enqueue/activate только
 *   для приказов с точечной/секторной целью (move, jump_hyper): для них
 *   отсутствие params — не отказ, а норма. Для приказов с целью-объектом
 *   (analyze/mine/pickup/attack) offer не используется — listOrders сам ищет
 *   кандидатов среди известных игроку объектов и проверяет их через activate,
 *   так что список никогда не предложит то, что отклонит addTask.
 */
export type ValidateMode = 'enqueue' | 'activate' | 'offer';

export async function validateAction(
  ctx: ActionCtx,
  entity: EntityRow,
  action: ActionType,
  params: ActionParams | null,
  mode: ValidateMode,
): Promise<Validation> {
  switch (action) {
    case 'scan':
      return { ok: true };

    case 'move': {
      if (!entityClass(entity).mobile) return { ok: false, reason: 'СУЩНОСТЬ НЕПОДВИЖНА' };
      if (!params || (params.kind !== 'point' && params.kind !== 'object')) {
        // В списке приказов цель ещё не выбрана — это нормально, не отказ
        if (mode === 'offer') return { ok: true };
        return { ok: false, reason: 'НУЖНА ТОЧКА ИЛИ ЦЕЛЬ' };
      }
      if (params.kind === 'object') {
        const obj = await getObject(ctx, params.objectId);
        if (!obj) return { ok: false, reason: 'ЦЕЛЬ НЕ СУЩЕСТВУЕТ' };
        if (mode === 'activate' && obj.sectorId !== entity.sectorId)
          return { ok: false, reason: 'ЦЕЛЬ НЕ В ТЕКУЩЕМ СЕКТОРЕ' };
      }
      return { ok: true };
    }

    case 'jump_hyper': {
      if (!entityClass(entity).mobile) return { ok: false, reason: 'СУЩНОСТЬ НЕПОДВИЖНА' };
      if (!params || params.kind !== 'sector') {
        if (mode === 'offer') return { ok: true };
        return { ok: false, reason: 'НЕ УКАЗАН СЕКТОР' };
      }
      if (!sectorExists(params.sectorId, ctx.cfg.world))
        return { ok: false, reason: 'СЕКТОР ВНЕ ГАЛАКТИКИ' };
      if (mode === 'activate' && !sectorsAdjacent(entity.sectorId, params.sectorId))
        return { ok: false, reason: 'ТОЛЬКО СОСЕДНИЕ СЕКТОРА (MVP)' };
      return { ok: true };
    }

    case 'interact': {
      // Расстыковка всегда возможна и не требует цели — направление сервер
      // решает сам по текущему dockedObjectId (ТЗ v0.02 п. 3.2: «Взаимодействие»
      // объединяет стыковку и расстыковку в один приказ).
      if (entity.dockedObjectId) return { ok: true };
      if (mode === 'enqueue') return { ok: true };
      const target = await findDockable(ctx, entity);
      return target ? { ok: true } : { ok: false, reason: 'НЕЧЕГО ПОДСТЫКОВАТЬ' };
    }

    case 'analyze': {
      if (!hasModuleGranting(entity, 'analyze')) return { ok: false, reason: 'НЕТ МОДУЛЯ' };
      if (mode === 'enqueue') {
        if (!params || params.kind !== 'object') return { ok: false, reason: 'НЕ УКАЗАНА ЦЕЛЬ' };
        const obj = await getObject(ctx, params.objectId);
        return obj ? { ok: true } : { ok: false, reason: 'ОБЪЕКТ НЕ СУЩЕСТВУЕТ' };
      }
      const r = await nearObjectFromParams(ctx, entity, params);
      return 'reason' in r ? { ok: false, reason: r.reason } : { ok: true };
    }

    case 'mine': {
      if (!hasModuleGranting(entity, 'mine')) return { ok: false, reason: 'НЕТ МОДУЛЯ' };
      if (mode === 'enqueue') {
        if (!params || params.kind !== 'object') return { ok: false, reason: 'НЕ УКАЗАНА ЦЕЛЬ' };
        const obj = await getObject(ctx, params.objectId);
        if (!obj) return { ok: false, reason: 'ОБЪЕКТ НЕ СУЩЕСТВУЕТ' };
        if (!obj.resourceType) return { ok: false, reason: 'ОБЪЕКТ БЕЗ РЕСУРСА' };
        return { ok: true };
      }
      const r = await nearObjectFromParams(ctx, entity, params);
      if ('reason' in r) return { ok: false, reason: r.reason };
      if (!r.obj.resourceType || (r.obj.resourceAmount ?? 0) <= 0)
        return { ok: false, reason: 'РЕСУРС ИСЧЕРПАН' };
      if (await cargoFull(ctx, entity)) return { ok: false, reason: 'ТРЮМ ПЕРЕПОЛНЕН' };
      return { ok: true };
    }

    case 'pickup': {
      if (mode === 'enqueue') {
        if (!params || params.kind !== 'object') return { ok: false, reason: 'НЕ УКАЗАНА ЦЕЛЬ' };
        const obj = await getObject(ctx, params.objectId);
        if (!obj) return { ok: false, reason: 'ОБЪЕКТ НЕ СУЩЕСТВУЕТ' };
        if (obj.type !== 'container') return { ok: false, reason: 'ОБЪЕКТ НЕ ПОДБИРАЕМ' };
        return { ok: true };
      }
      const r = await nearObjectFromParams(ctx, entity, params);
      if ('reason' in r) return { ok: false, reason: r.reason };
      if (r.obj.type !== 'container') return { ok: false, reason: 'ОБЪЕКТ НЕ ПОДБИРАЕМ' };
      if (await cargoFull(ctx, entity)) return { ok: false, reason: 'ТРЮМ ПЕРЕПОЛНЕН' };
      return { ok: true };
    }

    case 'attack': {
      if (totalDamage(entity) <= 0) return { ok: false, reason: 'НЕТ МОДУЛЯ ВООРУЖЕНИЯ' };
      if (mode === 'enqueue') {
        if (!params || params.kind !== 'object') return { ok: false, reason: 'НЕ УКАЗАНА ЦЕЛЬ' };
        const obj = await getObject(ctx, params.objectId);
        if (!obj) return { ok: false, reason: 'ОБЪЕКТ НЕ СУЩЕСТВУЕТ' };
        if (!isAttackable(obj)) return { ok: false, reason: 'ЦЕЛЬ НЕУЯЗВИМА' };
        return { ok: true };
      }
      const r = await nearObjectFromParams(ctx, entity, params);
      if ('reason' in r) return { ok: false, reason: r.reason };
      if (!isAttackable(r.obj)) return { ok: false, reason: 'ЦЕЛЬ НЕУЯЗВИМА' };
      return { ok: true };
    }

    case 'special': {
      // Резерв под будущие модули (ТЗ v0.02 п. 3.2): пока ни один модуль не
      // указывает 'special' в grants, приказ честно недоступен всем классам —
      // это не заглушка, а состояние каталога без контента, а не в коде.
      if (!hasModuleGranting(entity, 'special')) return { ok: false, reason: 'НЕТ МОДУЛЯ' };
      return { ok: true };
    }
  }
}

/** Ближайший объект с атрибутом «стыковочный узел» — любого типа, не только станции. */
async function findDockable(ctx: ActionCtx, entity: EntityRow): Promise<ObjectRow | null> {
  const inSector = await ctx.db
    .select()
    .from(objects)
    .where(eq(objects.sectorId, entity.sectorId));
  return (
    inSector.find(
      (o) => !!(o.props as Record<string, unknown>).dockable && isNear(entity, o, ctx.cfg),
    ) ?? null
  );
}

/** Что роняет уничтоженная цель (ТЗ v0.02 п. 3.2: «Атака» → контейнер добычи). */
function lootContents(obj: ObjectRow): string {
  if (obj.type === 'asteroid') return obj.resourceType ? `${obj.resourceType}-ore` : 'ore-debris';
  if (obj.type === 'phenomenon') return 'anomaly-residue';
  return 'debris';
}

/** Выполняет результат действия; возвращает строку для журнала. */
export async function executeAction(
  ctx: ActionCtx,
  entity: EntityRow,
  action: ActionType,
  params: ActionParams | null,
): Promise<string> {
  const { db, cfg, pid } = ctx;
  switch (action) {
    case 'scan': {
      await ensureSectorGenerated(db, entity.sectorId, cfg.world);
      const objs = await db
        .select({ id: objects.id })
        .from(objects)
        .where(eq(objects.sectorId, entity.sectorId));
      if (objs.length > 0) {
        await db
          .insert(knownObjects)
          .values(objs.map((o) => ({ playerId: pid, objectId: o.id, level: 'scanned' })))
          .onConflictDoNothing();
      }
      return `СКАНИРОВАНИЕ: ОБНАРУЖЕНО ОБЪЕКТОВ: ${objs.length}`;
    }

    case 'move': {
      const p = params as Extract<ActionParams, { kind: 'point' | 'object' }>;
      let x: number, y: number, label: string;
      if (p.kind === 'object') {
        const obj = await getObject(ctx, p.objectId);
        if (!obj) return 'ПРЫЖОК ОТМЕНЁН: ЦЕЛЬ ИСЧЕЗЛА';
        x = obj.x;
        y = obj.y;
        label = obj.type.toUpperCase();
      } else {
        x = p.x;
        y = p.y;
        label = `[${p.x}; ${p.y}]`;
      }
      await db
        .update(entities)
        .set({ x, y, dockedObjectId: null })
        .where(eq(entities.id, entity.id));
      return `ПРЫЖОК ВЫПОЛНЕН: ${entity.name} → ${label}`;
    }

    case 'jump_hyper': {
      const p = params as Extract<ActionParams, { kind: 'sector' }>;
      await ensureSectorGenerated(db, p.sectorId, cfg.world);
      await db
        .update(entities)
        .set({ sectorId: p.sectorId, x: 0, y: 0, dockedObjectId: null })
        .where(eq(entities.id, entity.id));
      await markVisited(db, pid, p.sectorId);
      return `ГИПЕРПРЫЖОК ВЫПОЛНЕН: ${entity.name} → СЕКТОР ${p.sectorId}`;
    }

    case 'interact': {
      if (entity.dockedObjectId) {
        await db.update(entities).set({ dockedObjectId: null }).where(eq(entities.id, entity.id));
        return `РАССТЫКОВКА ВЫПОЛНЕНА: ${entity.name}`;
      }
      const target = await findDockable(ctx, entity);
      if (!target) return 'ВЗАИМОДЕЙСТВИЕ ОТМЕНЕНО: ЦЕЛЬ НЕДОСТУПНА';
      await db
        .update(entities)
        .set({ dockedObjectId: target.id })
        .where(eq(entities.id, entity.id));
      const name = (target.props as { name?: string }).name ?? target.type.toUpperCase();
      return `ПРИСТЫКОВАН: ${entity.name} → ${name}`;
    }

    case 'analyze': {
      const p = params as Extract<ActionParams, { kind: 'object' }>;
      await db
        .insert(knownObjects)
        .values({ playerId: pid, objectId: p.objectId, level: 'analyzed' })
        .onConflictDoUpdate({
          target: [knownObjects.playerId, knownObjects.objectId],
          set: { level: 'analyzed' },
        });
      const obj = await getObject(ctx, p.objectId);
      return `АНАЛИЗ ЗАВЕРШЁН: ${obj?.type.toUpperCase() ?? 'ОБЪЕКТ'}`;
    }

    case 'mine': {
      const p = params as Extract<ActionParams, { kind: 'object' }>;
      const obj = await getObject(ctx, p.objectId);
      if (!obj || !obj.resourceType || (obj.resourceAmount ?? 0) <= 0)
        return 'ДОБЫЧА ОТМЕНЕНА: РЕСУРС ИСЧЕРПАН';
      const left = (obj.resourceAmount ?? 0) - 1;
      await db
        .update(objects)
        .set({
          resourceAmount: left,
          respawnAt:
            left <= 0 ? new Date(Date.now() + cfg.world.respawnMinutes * 60_000) : obj.respawnAt,
        })
        .where(eq(objects.id, obj.id));
      // Порция ресурса в трюм добывающей сущности: upsert строки ресурса
      const [existing] = await db
        .select()
        .from(cargo)
        .where(
          and(
            eq(cargo.entityId, entity.id),
            eq(cargo.kind, 'resource'),
            eq(cargo.itemType, obj.resourceType),
          ),
        );
      if (existing) {
        await db
          .update(cargo)
          .set({ qty: sql`${cargo.qty} + 1` })
          .where(eq(cargo.id, existing.id));
      } else {
        await db.insert(cargo).values({
          entityId: entity.id,
          playerId: pid,
          kind: 'resource',
          itemType: obj.resourceType,
          qty: 1,
        });
      }
      return `ДОБЫТО: ${obj.resourceType.toUpperCase()} x1 (ОСТАТОК: ${left})`;
    }

    case 'pickup': {
      const p = params as Extract<ActionParams, { kind: 'object' }>;
      const obj = await getObject(ctx, p.objectId);
      if (!obj) return 'ПОДБОР ОТМЕНЁН: ОБЪЕКТ ИСЧЕЗ';
      await db.insert(cargo).values({
        entityId: entity.id,
        playerId: pid,
        kind: 'object',
        itemType: `${obj.type}:${(obj.props as { contents?: string }).contents ?? 'unknown'}`,
        qty: 1,
        props: obj.props,
      });
      // Объект покидает сектор: чистим ссылки знания всех игроков, затем сам объект
      await db.delete(knownObjects).where(eq(knownObjects.objectId, obj.id));
      await db.delete(objects).where(eq(objects.id, obj.id));
      return `ПОДОБРАНО: ${obj.type.toUpperCase()}`;
    }

    case 'attack': {
      const p = params as Extract<ActionParams, { kind: 'object' }>;
      const obj = await getObject(ctx, p.objectId);
      if (!obj) return 'АТАКА ОТМЕНЕНА: ЦЕЛЬ ИСЧЕЗЛА';
      const dmg = totalDamage(entity);
      const hp = Number((obj.props as Record<string, unknown>).hp ?? 0);
      const left = hp - dmg;
      if (left > 0) {
        await db
          .update(objects)
          .set({ props: { ...(obj.props as object), hp: left } })
          .where(eq(objects.id, obj.id));
        return `АТАКА: ${obj.type.toUpperCase()} — УРОН ${dmg}, ОСТАТОК HP ${left}`;
      }
      // Цель уничтожена: роняет контейнер добычи на своих координатах
      await db.insert(objects).values({
        sectorId: obj.sectorId,
        x: obj.x,
        y: obj.y,
        type: 'container',
        props: { contents: lootContents(obj) },
        resourceType: null,
        resourceAmount: null,
        maxResource: null,
      });
      await db.delete(knownObjects).where(eq(knownObjects.objectId, obj.id));
      await db.delete(objects).where(eq(objects.id, obj.id));
      return `ЦЕЛЬ УНИЧТОЖЕНА: ${obj.type.toUpperCase()} (УРОН ${dmg}) — ОСТАВЛЕН КОНТЕЙНЕР`;
    }

    case 'special':
      // Недостижимо: validateAction отклоняет ещё на постановке, пока ни один
      // модуль не даёт 'special'. Ветка — задел на будущий модуль (roadmap).
      return 'СПЕЦИАЛЬНОЕ ДЕЙСТВИЕ: НЕТ АКТИВНОГО МОДУЛЯ';
  }
}
