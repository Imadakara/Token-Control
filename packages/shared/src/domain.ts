import type { EntityClassId, ModuleId } from './entities';

/** Типы действий бортового компьютера (ТЗ п. 6). */
export const ACTION_TYPES = [
  'scan',
  'jump_local',
  'jump_hyper',
  'dock',
  'analyze',
  'mine',
  'pickup',
] as const;
export type ActionType = (typeof ACTION_TYPES)[number];

/** Классы стоимости; значения в ОВМ приходят из GameConfig. */
export type CostClass = 'low' | 'medium' | 'high' | 'very_high';

/** Типы объектов сектора (ТЗ п. 2, п. 8). */
export const OBJECT_TYPES = ['station', 'asteroid', 'container', 'phenomenon'] as const;
export type ObjectType = (typeof OBJECT_TYPES)[number];

/** Статус задачи в слоте очереди. */
export type QueueTaskStatus = 'waiting' | 'active' | 'infeasible';

export interface QueueTask {
  /** Сущность-исполнитель: очередь приказов ведётся по сущностям (ТЗ v0.02 п. 3). */
  entityId: string;
  /** Номер слота, 1..GameConfig.orderSlots; слот 1 — активный. */
  slot: number;
  action: ActionType;
  /** Параметр действия: цель или точка (для scan/dock — отсутствует). */
  params: ActionParams | null;
  costOvm: number;
  progressOvm: number;
  status: QueueTaskStatus;
  /** Момент активации (ISO); клиент анимирует кулдаун исполнения. */
  activatedAt: string | null;
}

export type ActionParams =
  | { kind: 'object'; objectId: string }
  | { kind: 'point'; x: number; y: number }
  | { kind: 'sector'; sectorId: string };

/** Уровень знания игрока об объекте. */
export type KnownLevel = 'scanned' | 'analyzed';

export interface SectorObject {
  id: string;
  sectorId: string;
  type: ObjectType;
  x: number;
  y: number;
  /** Раскрытые анализом свойства; null, если объект только просканирован. */
  props: Record<string, unknown> | null;
  resourceAmount: number | null;
}

/**
 * Статус сущности (ТЗ v0.02 п. 2 требует параметр, не определяя его).
 * Вычисляется сервером, не хранится.
 */
export type EntityStatus = 'idle' | 'busy' | 'starved' | 'docked' | 'damaged';

/** Сущность под управлением игрока: корабль или стационарный объект. */
export interface EntityState {
  id: string;
  name: string;
  classId: EntityClassId;
  status: EntityStatus;
  sectorId: string;
  x: number;
  y: number;
  dockedObjectId: string | null;
  modules: ModuleId[];
  /**
   * Ключ группы: сущности в одних координатах сектора образуют группу,
   * для которой возможны групповые приказы (ТЗ v0.02 п. 2.1).
   */
  groupKey: string;
  /** Порядок раздачи ОВМ: меньше — раньше (ТЗ v0.02 п. 3). */
  priority: number;
  hp: number;
  hpMax: number;
  cargoCapacity: number;
  cargoUsed: number;
  /** Разбивка груза этой сущности по типу предмета. */
  cargo: CargoItem[];
  /** Очередь приказов этой сущности, отсортирована по слоту. */
  orders: QueueTask[];
}

export interface CargoItem {
  itemType: string;
  qty: number;
}

/** Что за параметр нужен приказу, чтобы клиент знал, какой picker открыть. */
export type OrderTarget = 'none' | 'point' | 'object' | 'sector';

/**
 * Приказ в списке доступных сущности (ТЗ v0.02 п. 3.1). Сервер уже проверил
 * условия — клиенту остаётся только показать и, если available, дать выбрать.
 * Недоступные приказы тоже присутствуют в списке (затенённые, с причиной).
 */
export interface OrderOption {
  action: ActionType;
  costOvm: number;
  available: boolean;
  reason: string | null;
  target: OrderTarget;
  /** Только для target='object': известные сущности объекты-кандидаты рядом. */
  candidates?: { objectId: string; label: string }[];
}
