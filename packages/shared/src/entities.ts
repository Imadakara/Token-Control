import type { ActionType } from './domain';

/**
 * Каталог классов сущностей и модулей (ТЗ v0.02 п. 2).
 * Это контент, а не данные: он нужен и серверу (правила доступности приказов),
 * и клиенту (лейблы), поэтому живёт в shared, а не в таблицах БД.
 * В `entities.class_id` / `entities.modules` лежат ключи отсюда.
 */

export const MODULE_IDS = ['mining_laser', 'railgun', 'refinery', 'survey_array'] as const;
export type ModuleId = (typeof MODULE_IDS)[number];

export interface ModuleDef {
  id: ModuleId;
  title: string;
  /** Приказы, которые модуль открывает своей сущности (game/actions.ts, game/orders.ts). */
  grants: ActionType[];
  /** Урон за исполнение приказа «Атака»; null — модуль невоенный. */
  damage: number | null;
}

export const MODULES: Record<ModuleId, ModuleDef> = {
  mining_laser: { id: 'mining_laser', title: 'БУРОВОЙ ЛАЗЕР', grants: ['mine'], damage: null },
  railgun: { id: 'railgun', title: 'РЕЛЬСОТРОН', grants: [], damage: 3 },
  refinery: { id: 'refinery', title: 'ПЕРЕРАБОТЧИК', grants: [], damage: null },
  survey_array: { id: 'survey_array', title: 'СКАНЕРНАЯ РЕШЁТКА', grants: ['analyze'], damage: null },
};

export const ENTITY_CLASS_IDS = ['scout_mk1', 'hauler_mk1', 'gate'] as const;
export type EntityClassId = (typeof ENTITY_CLASS_IDS)[number];

export interface EntityClassDef {
  id: EntityClassId;
  title: string;
  /** false — стационарный объект (врата, будущие постройки): приказ move недоступен. */
  mobile: boolean;
  cargoCapacity: number;
  hpMax: number;
  /** Модули «из коробки» при создании сущности этого класса. */
  baseModules: ModuleId[];
  /** Префикс автоимени: «РАЗВЕДЧИК-001». */
  namePrefix: string;
}

export const ENTITY_CLASSES: Record<EntityClassId, EntityClassDef> = {
  scout_mk1: {
    id: 'scout_mk1',
    title: 'РАЗВЕДЧИК MK1',
    mobile: true,
    cargoCapacity: 100,
    hpMax: 10,
    baseModules: ['mining_laser', 'survey_array', 'railgun'],
    namePrefix: 'БОРТ',
  },
  hauler_mk1: {
    id: 'hauler_mk1',
    title: 'ГРУЗОВОЗ MK1',
    mobile: true,
    cargoCapacity: 400,
    hpMax: 16,
    baseModules: [],
    namePrefix: 'ТРЮМ',
  },
  gate: {
    id: 'gate',
    title: 'МЕЖЗВЁЗДНЫЕ ВРАТА',
    mobile: false,
    cargoCapacity: 0,
    hpMax: 100,
    baseModules: [],
    namePrefix: 'ВРАТА',
  },
};

export function isEntityClassId(v: string): v is EntityClassId {
  return (ENTITY_CLASS_IDS as readonly string[]).includes(v);
}

export function isModuleId(v: string): v is ModuleId {
  return (MODULE_IDS as readonly string[]).includes(v);
}
