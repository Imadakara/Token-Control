import type {
  ActionType,
  ConfigResponse,
  EntityState,
  EntityStatus,
  GalaxyMapResponse,
  LogEntry,
  SectorMapResponse,
  StateResponse,
} from '@tokencontrol/shared';
import { api, connectWs, getToken, hasToken, logout } from './api';
import { connector } from './connector.svelte';
import { t } from './i18n.svelte';
import type { Screen } from './screens';

/** Режим выбора параметра приказа на карте (ТЗ п. 5: постановка задачи). */
export interface PickMode {
  action: ActionType;
  target: 'object' | 'point' | 'sector';
  /** Кому уйдёт приказ после выбора цели; несколько — групповой приказ. */
  entityIds: string[];
}

export const ACTION_LABELS: Record<ActionType, string> = {
  scan: 'СКАНИРОВАНИЕ',
  move: 'ПРЫЖОК В СЕКТОРЕ',
  jump_hyper: 'ГИПЕРПРЫЖОК',
  interact: 'ВЗАИМОДЕЙСТВИЕ',
  analyze: 'АНАЛИЗ ОБЪЕКТА',
  mine: 'ДОБЫЧА РЕСУРСА',
  pickup: 'ПОДБОР ОБЪЕКТА',
  attack: 'АТАКА',
  special: 'СПЕЦИАЛЬНОЕ ДЕЙСТВИЕ',
  upload_data: 'ЗАГРУЗКА ДАННЫХ',
  build_gate: 'ПОСТРОЙКА ВРАТ',
};

/** Статус сущности (ТЗ v0.02 п. 2); используется во «Флотилии», «Приказах» и на карте. */
export const STATUS_LABELS: Record<EntityStatus, string> = {
  idle: 'ПРОСТОЙ',
  busy: 'ВЫПОЛНЯЕТ',
  starved: 'ОЖИДАНИЕ ПОТОКА',
  docked: 'ПРИСТЫКОВАН',
  damaged: 'ПОВРЕЖДЁН',
};

export function entityStatusText(e: EntityState): string {
  const head = e.orders[0];
  if (e.status === 'busy' && head) {
    return `${t(STATUS_LABELS.busy)}: ${t(ACTION_LABELS[head.action])}`;
  }
  return t(STATUS_LABELS[e.status]);
}

class Game {
  authorized = $state(hasToken());
  online = $state(false);
  playerName = $state(localStorage.getItem('tc_player') ?? '');
  screen = $state<Screen>('orders');
  state = $state<StateResponse | null>(null);
  config = $state<ConfigResponse | null>(null);
  sector = $state<SectorMapResponse | null>(null);
  galaxy = $state<GalaxyMapResponse | null>(null);
  journal = $state<LogEntry[]>([]);
  pick = $state<PickMode | null>(null);
  message = $state(''); // строка сообщений терминала
  crt = $state(localStorage.getItem('tc_crt') !== 'off');

  /** Сущность, выбранная в «Флотилии»; приказы по умолчанию уходят ей. */
  selectedEntityId = $state<string | null>(null);

  /**
   * Сколько модальных окон открыто (их регистрирует Overlay). Пока больше нуля,
   * App и экраны не трогают клавиши: иначе цифра, набранная в поле ввода,
   * переключала бы экран — обработчик App висит на window и зарегистрирован
   * раньше экранных, так что stopPropagation из экрана его не останавливает.
   */
  modalDepth = $state(0);

  /**
   * Фокус в текстовом поле проверяется по факту, а не хранится флагом:
   * зеркалить focusin/focusout ненадёжно (например, focusout не гарантирован,
   * когда сфокусированный элемент удаляют из DOM), и залипший флаг намертво
   * гасит клавиатуру всего интерфейса.
   */
  get keysCaptured(): boolean {
    if (this.modalDepth > 0) return true;
    const el = document.activeElement;
    return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement;
  }

  /** Флот игрока в порядке приоритета раздачи ОВМ. */
  get entities() {
    return this.state?.entities ?? [];
  }

  /** Ведущая сущность — на неё уходят приказы, если ничего не выбрано. */
  get leadEntity() {
    return this.entities[0] ?? null;
  }

  get selectedEntity() {
    return this.entities.find((e) => e.id === this.selectedEntityId) ?? this.leadEntity;
  }

  /** Скорость входящего потока ОВМ, оценка клиента по state_delta. */
  ratePerMin = $state(0);
  private lastTotal: number | null = null;
  private lastTotalAt = 0;
  private lastGrowthAt = 0;
  /** Без притока дольше этого окна показываем 0 (сессия агента завершилась). */
  private static readonly RATE_SILENCE_MS = 60_000;

  private disconnectWs: (() => void) | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;

  /** Дебаг-режим: вход с позывным DEBUG открывает панель отладки. */
  get debugMode(): boolean {
    return this.playerName === 'DEBUG';
  }

  async login(playerId: string): Promise<void> {
    await api.login(playerId);
    this.authorized = true;
    this.playerName = playerId;
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
    // Оценка входящего потока: суммарный «зачтённый» ОВМ = буфер + прогресс
    // приказов ВСЕХ сущностей флота
    const total =
      state.ovmBuffer +
      state.entities.reduce(
        (s, e) => s + e.orders.reduce((n, o) => n + o.progressOvm, 0),
        0,
      );
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

  /**
   * Постановка приказа сущностям: с параметром — через режим выбора цели на
   * карте. Несколько entityIds — групповой приказ (ТЗ v0.02 п. 2.1).
   */
  async chooseAction(action: ActionType, entityIds?: string[]): Promise<void> {
    const targets = entityIds ?? (this.selectedEntity ? [this.selectedEntity.id] : []);
    if (targets.length === 0) {
      this.say('НЕТ СУЩНОСТЕЙ');
      return;
    }
    switch (action) {
      case 'scan':
      case 'interact':
      case 'special':
      case 'upload_data':
        await this.enqueue(action, null, targets);
        break;
      case 'move':
      case 'build_gate':
        this.pick = { action, target: 'point', entityIds: targets };
        this.screen = 'sector';
        this.say('ВЫБЕРИТЕ ТОЧКУ ИЛИ ОБЪЕКТ [ENTER] — ОТМЕНА [ESC]');
        break;
      case 'analyze':
      case 'mine':
      case 'pickup':
      case 'attack':
        this.pick = { action, target: 'object', entityIds: targets };
        this.screen = 'sector';
        this.say('ВЫБЕРИТЕ ЦЕЛЬ [ENTER] — ОТМЕНА [ESC]');
        break;
      case 'jump_hyper':
        this.pick = { action, target: 'sector', entityIds: targets };
        this.screen = 'galaxy';
        this.say('ВЫБЕРИТЕ СЕКТОР [ENTER] — ОТМЕНА [ESC]');
        break;
    }
  }

  async enqueue(
    action: ActionType,
    params: Parameters<typeof api.ordersAdd>[2],
    entityIds?: string[],
  ): Promise<void> {
    const targets = entityIds ?? this.pick?.entityIds ?? [];
    try {
      const { results, state } = await api.ordersAdd(targets, action, params);
      this.applyState(state);
      const denied = results.filter((r) => !r.ok);
      const ok = results.length - denied.length;
      if (denied.length === 0) {
        this.say(`${t('ПРИКАЗ ОТДАН:')} ${t(ACTION_LABELS[action])}`);
      } else if (ok === 0) {
        this.say(`${t('ОТКАЗ:')} ${denied[0]!.reason ?? ''}`);
      } else {
        this.say(`${t('ПРИКАЗ ОТДАН:')} ${ok}/${results.length} — ${denied[0]!.reason ?? ''}`);
      }
    } catch (err) {
      this.say(`${t('ОТКАЗ:')} ${(err as Error).message}`);
    }
    this.pick = null;
  }

  cancelPick(): void {
    if (this.pick) {
      this.pick = null;
      this.screen = 'orders';
      this.say('ВЫБОР ОТМЕНЁН');
    }
  }

  toggleCrt(): void {
    this.crt = !this.crt;
    localStorage.setItem('tc_crt', this.crt ? 'on' : 'off');
  }
}

export const game = new Game();
