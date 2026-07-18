import type {
  ActionType,
  ConfigResponse,
  GalaxyMapResponse,
  LogEntry,
  SectorMapResponse,
  StateResponse,
} from '@tokencontrol/shared';
import { api, connectWs, getToken, hasToken, logout } from './api';
import { connector } from './connector.svelte';
import { t } from './i18n.svelte';

export type Screen =
  | 'queue'
  | 'sector'
  | 'galaxy'
  | 'cargo'
  | 'status'
  | 'journal'
  | 'settings';

/** Режим выбора параметра действия на карте (ТЗ п. 5: постановка задачи). */
export interface PickMode {
  action: ActionType;
  target: 'object' | 'point' | 'sector';
}

export const ACTION_LABELS: Record<ActionType, string> = {
  scan: 'СКАНИРОВАНИЕ',
  jump_local: 'ПРЫЖОК В СЕКТОРЕ',
  jump_hyper: 'ГИПЕРПРЫЖОК',
  dock: 'СТЫКОВКА',
  analyze: 'АНАЛИЗ ОБЪЕКТА',
  mine: 'ДОБЫЧА РЕСУРСА',
  pickup: 'ПОДБОР ОБЪЕКТА',
};

class Game {
  authorized = $state(hasToken());
  online = $state(false);
  screen = $state<Screen>('queue');
  state = $state<StateResponse | null>(null);
  config = $state<ConfigResponse | null>(null);
  sector = $state<SectorMapResponse | null>(null);
  galaxy = $state<GalaxyMapResponse | null>(null);
  journal = $state<LogEntry[]>([]);
  pick = $state<PickMode | null>(null);
  message = $state(''); // строка сообщений терминала
  crt = $state(localStorage.getItem('tc_crt') !== 'off');

  /** Скорость входящего потока ОВМ, оценка клиента по state_delta. */
  ratePerMin = $state(0);
  private lastTotal: number | null = null;
  private lastTotalAt = 0;
  private lastGrowthAt = 0;
  /** Без притока дольше этого окна показываем 0 (сессия агента завершилась). */
  private static readonly RATE_SILENCE_MS = 60_000;

  private disconnectWs: (() => void) | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;

  async login(playerId: string): Promise<void> {
    await api.login(playerId);
    this.authorized = true;
    await this.start();
  }

  logout(): void {
    logout();
    this.authorized = false;
    this.disconnectWs?.();
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.state = null;
    void connector.stop();
  }

  async start(): Promise<void> {
    if (!this.authorized) return;
    try {
      this.config = await api.config();
      await this.refresh();
      this.online = true;
    } catch {
      this.online = false;
    }
    this.disconnectWs?.();
    this.disconnectWs = connectWs((msg) => {
      if (msg.type === 'state_delta') this.applyState(msg.state);
      else if (msg.type === 'config_changed') this.config = msg.config;
      else if (msg.type === 'journal') this.onJournalEvent(msg.entry);
    });
    this.startPolling();

    // «Тихий» режим (ТЗ п. 11): окно скрыто/в трее — опрос сервера на паузе,
    // коннектор в Rust-потоке продолжает считать ОВМ.
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.stopPolling();
      else {
        void this.refresh().catch(() => {});
        this.startPolling();
      }
    });

    // Внутри Tauri-оболочки поднимаем Rust-коннектор Claude Code
    const token = getToken();
    if (token) void connector.start(token);
  }

  private startPolling(): void {
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = setInterval(() => void this.refresh().catch(() => {}), 5000);
  }

  private stopPolling(): void {
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = null;
  }

  async refresh(): Promise<void> {
    const [state, sector, galaxy] = await Promise.all([
      api.state(),
      api.sectorMap(),
      api.galaxyMap(),
    ]);
    this.applyState(state);
    this.sector = sector;
    this.galaxy = galaxy;
    this.online = true;
  }

  private applyState(state: StateResponse): void {
    // Оценка входящего потока: суммарный «зачтённый» ОВМ = буфер + прогресс задач
    const total =
      state.ovmBuffer + state.queue.reduce((s, q) => s + q.progressOvm, 0);
    const now = Date.now();
    if (this.lastTotal !== null && now > this.lastTotalAt) {
      const delta = total - this.lastTotal;
      if (delta > 0) {
        this.ratePerMin = Math.round((delta / ((now - this.lastTotalAt) / 60000)) * 10) / 10;
        this.lastGrowthAt = now;
      } else if (now - this.lastGrowthAt > Game.RATE_SILENCE_MS) {
        // Приток давно иссяк (агент не работает) — не показываем стухший поток
        this.ratePerMin = 0;
      }
    }
    this.lastTotal = total;
    this.lastTotalAt = now;
    this.state = state;
    // Карты могли устареть (скан/прыжок) — тихо обновляем
    void api.sectorMap().then((s) => (this.sector = s)).catch(() => {});
    void api.galaxyMap().then((g) => (this.galaxy = g)).catch(() => {});
  }

  async refreshJournal(): Promise<void> {
    const { entries } = await api.log();
    this.journal = entries;
  }

  /** Пуш завершения/пропуска задачи: строка терминала + свежий журнал. */
  private onJournalEvent(entry: LogEntry): void {
    if (entry.result.startsWith('НЕВЫПОЛНИМО')) {
      this.say(entry.result);
    } else if (entry.action in ACTION_LABELS) {
      this.say(
        `${t('ЗАДАЧА ВЫПОЛНЕНА:')} ${t(ACTION_LABELS[entry.action as ActionType])}`,
      );
    } else {
      this.say(entry.result);
    }
    this.journal = [entry, ...this.journal];
  }

  say(text: string): void {
    this.message = text;
  }

  /** Постановка действия: с параметром — через режим выбора цели на карте. */
  async chooseAction(action: ActionType): Promise<void> {
    switch (action) {
      case 'scan':
      case 'dock':
        await this.enqueue(action, null);
        break;
      case 'jump_local':
        this.pick = { action, target: 'point' };
        this.screen = 'sector';
        this.say('ВЫБЕРИТЕ ТОЧКУ ИЛИ ОБЪЕКТ [ENTER] — ОТМЕНА [ESC]');
        break;
      case 'analyze':
      case 'mine':
      case 'pickup':
        this.pick = { action, target: 'object' };
        this.screen = 'sector';
        this.say('ВЫБЕРИТЕ ЦЕЛЬ [ENTER] — ОТМЕНА [ESC]');
        break;
      case 'jump_hyper':
        this.pick = { action, target: 'sector' };
        this.screen = 'galaxy';
        this.say('ВЫБЕРИТЕ СЕКТОР [ENTER] — ОТМЕНА [ESC]');
        break;
    }
  }

  async enqueue(
    action: ActionType,
    params: Parameters<typeof api.queueAdd>[1],
  ): Promise<void> {
    try {
      const state = await api.queueAdd(action, params);
      this.applyState(state);
      this.say(`${t('ЗАДАЧА ПОСТАВЛЕНА:')} ${t(ACTION_LABELS[action])}`);
    } catch (err) {
      this.say(`${t('ОТКАЗ:')} ${(err as Error).message}`);
    }
    this.pick = null;
  }

  cancelPick(): void {
    if (this.pick) {
      this.pick = null;
      this.screen = 'queue';
      this.say('ВЫБОР ОТМЕНЁН');
    }
  }

  toggleCrt(): void {
    this.crt = !this.crt;
    localStorage.setItem('tc_crt', this.crt ? 'on' : 'off');
  }
}

export const game = new Game();
