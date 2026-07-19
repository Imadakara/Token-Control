import type {
  ActionParams,
  ActionType,
  AuthResponse,
  ChainResponse,
  ConfigResponse,
  GalaxyMapResponse,
  KnowledgeResponse,
  LogResponse,
  OrdersAddResponse,
  OrdersAvailableResponse,
  SectorMapResponse,
  StateResponse,
  TechResponse,
  WsServerMessage,
} from '@tokencontrol/shared';

const BASE = '/api';

let token: string | null = localStorage.getItem('tc_token');

export function hasToken(): boolean {
  return token !== null;
}

export function getToken(): string | null {
  return token;
}

export function logout(): void {
  token = null;
  localStorage.removeItem('tc_token');
}

class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init?.headers,
    },
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new ApiError(res.status, String(body.error ?? `HTTP ${res.status}`));
  }
  return body as T;
}

export const api = {
  async login(playerId: string): Promise<void> {
    const { token: t } = await request<AuthResponse>('/auth/dev', {
      method: 'POST',
      body: JSON.stringify({ playerId }),
    });
    token = t;
    localStorage.setItem('tc_token', t);
  },
  health: () => request<{ status: string }>('/health'),
  config: () => request<ConfigResponse>('/config'),
  state: () => request<StateResponse>('/state'),
  sectorMap: () => request<SectorMapResponse>('/map/sector'),
  galaxyMap: () => request<GalaxyMapResponse>('/map/galaxy'),
  log: (cursor?: string) => request<LogResponse>(`/log${cursor ? `?cursor=${cursor}` : ''}`),
  /** Что сущность (или весь флот, если entityId не задан) может сделать сейчас. */
  ordersAvailable: (entityId?: string) =>
    request<OrdersAvailableResponse>(`/orders/available${entityId ? `?entityId=${entityId}` : ''}`),
  /** Приказ одной или нескольким сущностям (ТЗ v0.02 п. 3). */
  ordersAdd: (entityIds: string[], action: ActionType, params: ActionParams | null) =>
    request<OrdersAddResponse>('/orders/add', {
      method: 'POST',
      body: JSON.stringify({ entityIds, action, params }),
    }),
  ordersRemove: (entityId: string, slot: number) =>
    request<StateResponse>('/orders/remove', {
      method: 'POST',
      body: JSON.stringify({ entityId, slot }),
    }),
  ordersReorder: (entityId: string, from: number, to: number) =>
    request<StateResponse>('/orders/reorder', {
      method: 'POST',
      body: JSON.stringify({ entityId, from, to }),
    }),
  fleetPriority: (entityIds: string[]) =>
    request<StateResponse>('/fleet/priority', {
      method: 'POST',
      body: JSON.stringify({ entityIds }),
    }),
  fleetRename: (entityId: string, name: string) =>
    request<StateResponse>('/fleet/rename', {
      method: 'POST',
      body: JSON.stringify({ entityId, name }),
    }),
  /** Только реально открытые игроком записи (ТЗ v0.02 п. 5). */
  knowledge: () => request<KnowledgeResponse>('/knowledge'),
  tech: () => request<TechResponse>('/tech'),
  techResearch: (techId: string) =>
    request<StateResponse>('/tech/research', { method: 'POST', body: JSON.stringify({ techId }) }),
  /** Цепь Миров (ТЗ v0.02 п. 4). */
  chain: () => request<ChainResponse>('/chain'),
  chainConnect: (keyId: string) =>
    request<StateResponse>('/chain/connect', { method: 'POST', body: JSON.stringify({ keyId }) }),
  /** Дебаг-команда (сервер пускает только капитана DEBUG). */
  debugCredit: (ovm: number) =>
    request<StateResponse>('/debug/credit', { method: 'POST', body: JSON.stringify({ ovm }) }),
  debugSpawn: (classId: string) =>
    request<StateResponse>('/debug/spawn', { method: 'POST', body: JSON.stringify({ classId }) }),
  debugChainKey: (targetSectorId?: string) =>
    request<{ keyId: string }>('/debug/chain-key', {
      method: 'POST',
      body: JSON.stringify({ targetSectorId }),
    }),
};

/** WS-подписка на пуши сервера; переподключение с бэкоффом. */
export function connectWs(onMessage: (msg: WsServerMessage) => void): () => void {
  let socket: WebSocket | null = null;
  let closed = false;
  let retry = 1000;

  const open = () => {
    if (closed || !token) return;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    socket = new WebSocket(`${proto}://${location.host}/ws?token=${token}`);
    socket.onmessage = (e) => {
      try {
        onMessage(JSON.parse(e.data as string) as WsServerMessage);
      } catch {
        /* мусор в канале игнорируем */
      }
    };
    socket.onopen = () => {
      retry = 1000;
    };
    socket.onclose = () => {
      if (!closed) setTimeout(open, (retry = Math.min(retry * 2, 15000)));
    };
  };

  open();
  return () => {
    closed = true;
    socket?.close();
  };
}
