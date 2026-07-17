import type {
  ActionParams,
  ActionType,
  CargoItem,
  QueueTask,
  SectorObject,
  ShipState,
} from './domain';
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
  ship: ShipState;
  queue: QueueTask[];
  ovmBuffer: number;
  cargo: CargoItem[];
  cargoCapacity: number;
}

// ---- Queue ----

export interface QueueAddRequest {
  action: ActionType;
  params: ActionParams | null;
}
export interface QueueRemoveRequest {
  slot: 1 | 2 | 3;
}
export interface QueueReorderRequest {
  from: 2 | 3;
  to: 2 | 3;
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
  | { type: 'progress'; slot: 1 | 2 | 3; progressOvm: number; costOvm: number; ratePerMin: number }
  | { type: 'state_delta'; state: StateResponse }
  | { type: 'journal'; entry: LogEntry }
  | { type: 'config_changed'; config: GameConfig };
