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
  /** Лимиты анти-абуза (ТЗ п. 9). */
  limits: {
    maxOvmPerMinute: number;
    maxOvmPerHour: number;
    maxOvmPerDay: number;
  };
  /** Вместимость трюма (единая для MVP). */
  cargoCapacity: number;
  /** Радиус «возле объекта» для стыковки/анализа/добычи/подбора. */
  nearDistance: number;
}

export const DEFAULT_GAME_CONFIG: GameConfig = {
  actionCosts: {
    scan: 10,
    jump_local: 100,
    jump_hyper: 1000,
    dock: 10,
    analyze: 100,
    mine: 100,
    pickup: 10,
  },
  conversion: { kCacheW: 1, kCacheR: 0.1, n: 1000 },
  ovmBufferCap: 100_000,
  limits: {
    maxOvmPerMinute: 500,
    maxOvmPerHour: 10_000,
    maxOvmPerDay: 100_000,
  },
  cargoCapacity: 100,
  nearDistance: 10,
};
