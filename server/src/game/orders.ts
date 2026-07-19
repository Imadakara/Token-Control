import type { ActionType, OrderOption, OrderTarget } from '@tokencontrol/shared';
import { ACTION_TYPES } from '@tokencontrol/shared';
import { and, eq } from 'drizzle-orm';
import { knownObjects, objects, queues } from '../db/schema';
import { validateAction, type ActionCtx } from './actions';
import type { EntityRow } from './entities';

/**
 * Список приказов, доступных сущности прямо сейчас (ТЗ v0.02 п. 3.1): для
 * каждого типа приказа — стоимость, доступность, причина отказа и (для
 * приказов с целью-объектом) кандидаты рядом. Строится ПОВЕРХ validateAction,
 * а не параллельно ему — так UI никогда не предложит то, что отклонит
 * addTask при реальной постановке.
 */

const TARGET_KIND: Record<ActionType, OrderTarget> = {
  scan: 'none',
  dock: 'none',
  jump_local: 'point',
  jump_hyper: 'sector',
  analyze: 'object',
  mine: 'object',
  pickup: 'object',
};

type ObjectRow = typeof objects.$inferSelect;

function label(obj: ObjectRow): string {
  return `${obj.type.toUpperCase()} [${obj.x}; ${obj.y}]`;
}

/** Известные игроку объекты рядом с сущностью, подходящие приказу. */
async function candidateObjects(
  ctx: ActionCtx,
  entity: EntityRow,
  predicate: (obj: ObjectRow) => boolean,
): Promise<ObjectRow[]> {
  const rows = await ctx.db
    .select({ obj: objects })
    .from(knownObjects)
    .innerJoin(objects, eq(knownObjects.objectId, objects.id))
    .where(and(eq(knownObjects.playerId, ctx.pid), eq(objects.sectorId, entity.sectorId)));
  return rows
    .map((r) => r.obj)
    .filter(
      (o) => Math.hypot(entity.x - o.x, entity.y - o.y) <= ctx.cfg.game.nearDistance && predicate(o),
    );
}

const OBJECT_PREDICATE: Partial<Record<ActionType, (obj: ObjectRow) => boolean>> = {
  analyze: () => true,
  mine: (obj) => !!obj.resourceType && (obj.resourceAmount ?? 0) > 0,
  pickup: (obj) => obj.type === 'container',
};

const NO_CANDIDATES_REASON: Partial<Record<ActionType, string>> = {
  analyze: 'НЕТ ИЗВЕСТНЫХ ОБЪЕКТОВ РЯДОМ',
  mine: 'НЕТ ДОБЫВАЕМЫХ ОБЪЕКТОВ РЯДОМ',
  pickup: 'НЕТ ПОДБИРАЕМЫХ ОБЪЕКТОВ РЯДОМ',
};

async function optionFor(ctx: ActionCtx, entity: EntityRow, action: ActionType): Promise<OrderOption> {
  const costOvm = ctx.cfg.game.actionCosts[action];
  const target = TARGET_KIND[action];

  if (target === 'object') {
    const predicate = OBJECT_PREDICATE[action]!;
    const found = await candidateObjects(ctx, entity, predicate);
    if (found.length === 0) {
      return {
        action,
        costOvm,
        available: false,
        reason: NO_CANDIDATES_REASON[action]!,
        target,
        candidates: [],
      };
    }
    // Кандидат уже рядом и подходит по типу — 'activate' проверит остальное
    // (трюм, актуальность запаса и т.п.) тем же кодом, что исполнит addTask.
    const probe = await validateAction(
      ctx,
      entity,
      action,
      { kind: 'object', objectId: found[0]!.id },
      'activate',
    );
    return {
      action,
      costOvm,
      available: probe.ok,
      reason: probe.ok ? null : probe.reason,
      target,
      candidates: found.map((o) => ({ objectId: o.id, label: label(o) })),
    };
  }

  // none/point/sector: конкретной цели ещё нет — 'offer' проверяет только
  // общие условия (класс, подвижность); dock/scan игнорируют params и в
  // 'activate'-ветке делают это независимо от режима.
  const v = await validateAction(ctx, entity, action, null, 'offer');
  return { action, costOvm, available: v.ok, reason: v.ok ? null : v.reason, target };
}

export async function listOrders(ctx: ActionCtx, entity: EntityRow): Promise<OrderOption[]> {
  // addTask отказывает при заполненной очереди независимо от validateAction —
  // список обязан говорить то же самое, иначе доступный на вид приказ будет
  // падать 409-м при реальной постановке.
  const occupied = await ctx.db
    .select({ slot: queues.slot })
    .from(queues)
    .where(eq(queues.entityId, entity.id));
  if (occupied.length >= ctx.cfg.game.orderSlots) {
    return ACTION_TYPES.map((action) => ({
      action,
      costOvm: ctx.cfg.game.actionCosts[action],
      available: false,
      reason: 'ОЧЕРЕДЬ ЗАПОЛНЕНА',
      target: TARGET_KIND[action],
    }));
  }
  return Promise.all(ACTION_TYPES.map((action) => optionFor(ctx, entity, action)));
}
