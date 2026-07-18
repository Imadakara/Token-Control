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
  slot: 1 | 2 | 3;
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

export interface ShipState {
  sectorId: string;
  x: number;
  y: number;
  dockedObjectId: string | null;
}

export interface CargoItem {
  itemType: string;
  qty: number;
}
