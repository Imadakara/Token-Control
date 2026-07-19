import { createRng } from './rng';

/** Параметры генерации (часть game_config, ТЗ п. 12.2). */
export interface WorldGenParams {
  galaxySeed: string;
  galaxyWidth: number;
  galaxyHeight: number;
  startSector: string; // "gx:gy"
  sectorSize: number; // координаты объектов в [-size, size]
  /** Через сколько минут восстанавливается исчерпанный ресурс (ТЗ п. 8). */
  respawnMinutes: number;
}

export const DEFAULT_WORLD: WorldGenParams = {
  galaxySeed: 'token-control-mvp-1',
  // Расширено под личные домашние сектора (ТЗ v0.02 п. 4): коллизии редки, а
  // безвредны — объекты сектора и так глобальны и разделяемы между игроками.
  galaxyWidth: 32,
  galaxyHeight: 32,
  startSector: '5:5',
  sectorSize: 1000,
  respawnMinutes: 30,
};

export interface GeneratedObject {
  type: 'station' | 'asteroid' | 'container' | 'phenomenon';
  x: number;
  y: number;
  props: Record<string, unknown>;
  resourceType: string | null;
  resourceAmount: number | null;
  maxResource: number | null;
}

const ORE_TYPES = ['ferrum', 'silicium', 'iridium'] as const;

export function parseSectorId(id: string): { gx: number; gy: number } | null {
  const m = /^(\d+):(\d+)$/.exec(id);
  if (!m) return null;
  return { gx: Number(m[1]), gy: Number(m[2]) };
}

export function sectorExists(id: string, world: WorldGenParams): boolean {
  const c = parseSectorId(id);
  return !!c && c.gx >= 0 && c.gx < world.galaxyWidth && c.gy >= 0 && c.gy < world.galaxyHeight;
}

export function sectorsAdjacent(a: string, b: string): boolean {
  const ca = parseSectorId(a);
  const cb = parseSectorId(b);
  if (!ca || !cb) return false;
  return Math.abs(ca.gx - cb.gx) + Math.abs(ca.gy - cb.gy) === 1;
}

/**
 * Домашний сектор игрока (ТЗ v0.02 п. 4): в распоряжении игрока только один
 * сектор с псевдослучайной генерацией окружения. Детерминирован по позывному,
 * поэтому повторный вход не переселяет игрока.
 */
export function pickHomeSector(playerId: string, world: WorldGenParams): string {
  const rng = createRng(`${world.galaxySeed}/home/${playerId}`);
  return `${rng.int(0, world.galaxyWidth - 1)}:${rng.int(0, world.galaxyHeight - 1)}`;
}

/**
 * Детерминированная генерация содержимого сектора: один и тот же сид +
 * id сектора всегда дают одинаковый набор объектов.
 */
export function generateSector(sectorId: string, world: WorldGenParams): GeneratedObject[] {
  const rng = createRng(`${world.galaxySeed}/${sectorId}`);
  const objects: GeneratedObject[] = [];
  const S = world.sectorSize;
  const coord = () => Math.round((rng.next() * 2 - 1) * S);

  // Станция ≤ 1 (ТЗ п. 8)
  if (rng.next() < 0.6) {
    objects.push({
      type: 'station',
      x: coord(),
      y: coord(),
      props: { name: `STN-${rng.int(100, 999)}`, dockable: true },
      resourceType: null,
      resourceAmount: null,
      maxResource: null,
    });
  }

  const asteroids = rng.int(3, 8);
  for (let i = 0; i < asteroids; i++) {
    const ore = rng.pick(ORE_TYPES);
    const max = rng.int(5, 20);
    objects.push({
      type: 'asteroid',
      x: coord(),
      y: coord(),
      props: { ore },
      resourceType: ore,
      resourceAmount: max,
      maxResource: max,
    });
  }

  const containers = rng.int(0, 3);
  for (let i = 0; i < containers; i++) {
    objects.push({
      type: 'container',
      x: coord(),
      y: coord(),
      props: { contents: rng.pick(['scrap', 'supplies', 'data-core']) },
      resourceType: null,
      resourceAmount: null,
      maxResource: null,
    });
  }

  const phenomena = rng.int(0, 2);
  for (let i = 0; i < phenomena; i++) {
    objects.push({
      type: 'phenomenon',
      x: coord(),
      y: coord(),
      props: { class: rng.pick(['nebula', 'anomaly', 'pulsar-echo']) },
      resourceType: null,
      resourceAmount: null,
      maxResource: null,
    });
  }

  return objects;
}
