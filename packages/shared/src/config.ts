import type { ActionType } from './domain';

/**
 * Серверный игровой конфиг (ТЗ п. 12.2): всё калибруется без релиза клиента.
 * Клиент и коннектор получают его через GET /config.
 */
export interface GameConfig {
  /** Стоимости действий в ОВМ (МVP: 10/100/250/1000). */
  actionCosts: Record<ActionType, number>;
  /** Формула конвертации токенов: T = in + out + kCacheW*cache_creation + kCacheR*cache_read. */
  conversion: {
    kCacheW: number;
    kCacheR: number;
    /** ОВМ = T / N. */
    n: number;
  };
  /** Кап системного буфера ОВМ (ТЗ п. 5). */
  ovmBufferCap: number;
  /** Стоимость одного запроса к ассистенту в ОВМ (ТЗ v0.02 п. 7). */
  assistantCostOvm: number;
  /** Лимиты анти-абуза (ТЗ п. 9). */
  limits: {
    maxOvmPerMinute: number;
    maxOvmPerHour: number;
    maxOvmPerDay: number;
  };
  /** Вместимость трюма по умолчанию; класс сущности может её переопределить. */
  cargoCapacity: number;
  /** Радиус «возле объекта» для стыковки/анализа/добычи/подбора. */
  nearDistance: number;
  /** Кулдаун исполнения активной задачи после набора стоимости, сек. */
  taskCooldownSec: number;
  /** Слотов приказов на сущность (ТЗ v0.02 п. 3; MVP был жёстко 3). */
  orderSlots: number;
  /** Допуск «те же координаты» для группировки и приказов (ТЗ v0.02 п. 2.1). */
  coordEpsilon: number;
  /**
   * Как один поток ОВМ делится между очередями сущностей.
   * 'priority' — строго по приоритету с каскадом излишка (реализовано);
   * 'split' — задел на пропорциональное деление, пока не реализован.
   */
  ovmAllocation: 'priority' | 'split';
}

export const DEFAULT_GAME_CONFIG: GameConfig = {
  actionCosts: {
    scan: 10,
    move: 100,
    jump_hyper: 1000,
    interact: 10,
    analyze: 100,
    mine: 100,
    pickup: 10,
    attack: 100,
    special: 50,
    upload_data: 50,
    // Намеренно выше ovmBufferCap (ТЗ v0.02 п. 4): врата нельзя купить из
    // буфера, только накопить в счётчике самого приказа за много сессий.
    build_gate: 250_000,
  },
  conversion: { kCacheW: 1, kCacheR: 0.1, n: 1000 },
  ovmBufferCap: 100_000,
  assistantCostOvm: 300,
  limits: {
    maxOvmPerMinute: 500,
    maxOvmPerHour: 10_000,
    maxOvmPerDay: 100_000,
  },
  cargoCapacity: 100,
  nearDistance: 10,
  taskCooldownSec: 3,
  orderSlots: 3,
  coordEpsilon: 10,
  ovmAllocation: 'priority',
};
