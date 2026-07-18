import type {
  ActionParams,
  ActionType,
  AuthResponse,
  ConfigResponse,
  GalaxyMapResponse,
  LogResponse,
  SectorMapResponse,
  StateResponse,
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
  queueAdd: (action: ActionType, params: ActionParams | null) =>
    request<StateResponse>('/queue/add', {
      method: 'POST',
      body: JSON.stringify({ action, params }),
    }),
  queueRemove: (slot: 1 | 2 | 3) =>
    request<StateResponse>('/queue/remove', { method: 'POST', body: JSON.stringify({ slot }) }),
  queueReorder: (from: 2 | 3, to: 2 | 3) =>
    request<StateResponse>('/queue/reorder', {
      method: 'POST',
      body: JSON.stringify({ from, to }),
    }),
  undock: () => request<StateResponse>('/ship/undock', { method: 'POST' }),
  /** Дебаг-команда (сервер пускает только капитана DEBUG). */
  debugCredit: (ovm: number) =>
    request<StateResponse>('/debug/credit', { method: 'POST', body: JSON.stringify({ ovm }) }),
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
