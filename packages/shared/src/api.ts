import type { ActionParams, ActionType, EntityState, OrderOption, SectorObject } from './domain';
import type { GameConfig } from './config';

// ---- Auth ----

export interface AuthDevRequest {
  playerId: string;
}
export interface AuthResponse {
  token: string;
}

// ---- State ----

export interface StateResponse {
  /** Флот игрока: корабли и стационарные объекты, по приоритету раздачи ОВМ. */
  entities: EntityState[];
  /** Общий на игрока буфер ОВМ (ТЗ v0.02 п. 3: бар индивидуальный, буфер общий). */
  ovmBuffer: number;
}

// ---- Orders (ТЗ v0.02 п. 3) ----

/** Список доступных приказов по флоту или по одной сущности (?entityId=). */
export interface OrdersAvailableResponse {
  entities: { entityId: string; orders: OrderOption[] }[];
}

/** Постановка приказа. Несколько entityIds — групповой приказ (ТЗ v0.02 п. 2.1). */
export interface OrdersAddRequest {
  entityIds: string[];
  action: ActionType;
  params: ActionParams | null;
}
/** Веерная рассылка: каждая сущность валидируется независимо. */
export interface OrdersAddResponse {
  results: { entityId: string; ok: boolean; reason?: string }[];
  state: StateResponse;
}
export interface OrdersRemoveRequest {
  entityId: string;
  slot: number;
}
export interface OrdersReorderRequest {
  entityId: string;
  from: number;
  to: number;
}

// ---- Fleet ----

/** Новый порядок раздачи ОВМ: полный список id сущностей игрока. */
export interface FleetPriorityRequest {
  entityIds: string[];
}
export interface FleetRenameRequest {
  entityId: string;
  name: string;
}
/** Расстыковка — мгновенна и бесплатна (ТЗ п. 6.4), не приказ очереди. */
export interface ShipUndockRequest {
  entityId: string;
}

// ---- Credits (коннектор → сервер, ТЗ п. 7.4) ----

export interface CreditsSubmitRequest {
  packetSeq: number;
  ovm: number;
  tokens: {
    input: number;
    output: number;
    cacheCreation: number;
    cacheRead: number;
  };
  intervalStart: string; // ISO 8601
  intervalEnd: string;
}
export interface CreditsSubmitResponse {
  accepted: number;
  clipped: number;
}

// ---- Maps ----

export interface SectorMapResponse {
  sectorId: string;
  objects: SectorObject[]; // только известные игроку
}
export interface GalaxyMapResponse {
  currentSectorId: string;
  galaxyWidth: number;
  galaxyHeight: number;
  sectors: { id: string; gx: number; gy: number; visited: boolean }[];
}

// ---- Journal ----

export interface LogEntry {
  id: string;
  ts: string;
  action: ActionType | 'system';
  result: string;
  details: Record<string, unknown> | null;
}
export interface LogResponse {
  entries: LogEntry[];
  nextCursor: string | null;
}

// ---- Config ----

export type ConfigResponse = GameConfig;

// ---- WebSocket push (сервер → клиент) ----

export type WsServerMessage =
  | {
      type: 'progress';
      entityId: string;
      slot: number;
      progressOvm: number;
      costOvm: number;
      ratePerMin: number;
    }
  | { type: 'state_delta'; state: StateResponse }
  | { type: 'journal'; entry: LogEntry }
  | { type: 'config_changed'; config: GameConfig };
