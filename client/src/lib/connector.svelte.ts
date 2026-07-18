/**
 * Мост к Rust-коннектору Claude Code (работает только внутри Tauri-оболочки;
 * в браузерной dev-версии статус остаётся «недоступен»).
 */

export interface ConnectorStatus {
  running: boolean;
  /** Логи агента росли недавно (окно ~2 мин), а не «файлы существуют». */
  agentDetected: boolean;
  /** Секунд с последней активности агента; null — активности не было. */
  lastActivitySecs: number | null;
  filesTracked: number;
  freshRecords: number;
  outboxOvm: number;
  lastAccepted: number;
  lastClipped: number;
  lastError: string | null;
}

class ConnectorBridge {
  available = $state(false);
  status = $state<ConnectorStatus | null>(null);

  private started = false;

  get isTauri(): boolean {
    return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
  }

  /** Вызывается после логина: передаёт коннектору адрес сервера и токен. */
  async start(token: string): Promise<void> {
    if (!this.isTauri || this.started) return;
    this.started = true;
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const { listen } = await import('@tauri-apps/api/event');
      await listen<ConnectorStatus>('connector-status', (e) => {
        this.status = e.payload;
      });
      // Внутри Tauri веб-часть ходит на сервер напрямую (без vite-прокси)
      await invoke('connector_start', {
        serverUrl: 'http://127.0.0.1:8787',
        token,
      });
      this.available = true;
    } catch {
      this.available = false;
      this.started = false;
    }
  }

  async stop(): Promise<void> {
    if (!this.isTauri || !this.started) return;
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('connector_stop');
    } catch {
      /* остановка best-effort */
    }
    this.started = false;
  }
}

export const connector = new ConnectorBridge();
