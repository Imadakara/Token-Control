import { describe, expect, it } from 'vitest';
import {
  DEFAULT_WORLD,
  generateSector,
  sectorExists,
  sectorsAdjacent,
} from '../src/game/worldgen';

describe('worldgen', () => {
  it('детерминирован: один сид + сектор → одинаковые объекты', () => {
    const a = generateSector('3:4', DEFAULT_WORLD);
    const b = generateSector('3:4', DEFAULT_WORLD);
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThan(0);
  });

  it('разные сектора дают разное содержимое', () => {
    const a = generateSector('3:4', DEFAULT_WORLD);
    const b = generateSector('4:3', DEFAULT_WORLD);
    expect(a).not.toEqual(b);
  });

  it('станций не больше одной', () => {
    for (let gx = 0; gx < 10; gx++) {
      for (let gy = 0; gy < 10; gy++) {
        const objs = generateSector(`${gx}:${gy}`, DEFAULT_WORLD);
        expect(objs.filter((o) => o.type === 'station').length).toBeLessThanOrEqual(1);
      }
    }
  });

  it('границы галактики и соседство', () => {
    expect(sectorExists('0:0', DEFAULT_WORLD)).toBe(true);
    expect(sectorExists('9:9', DEFAULT_WORLD)).toBe(true);
    expect(sectorExists('10:5', DEFAULT_WORLD)).toBe(false);
    expect(sectorExists('x:y', DEFAULT_WORLD)).toBe(false);
    expect(sectorsAdjacent('5:5', '5:6')).toBe(true);
    expect(sectorsAdjacent('5:5', '6:6')).toBe(false);
    expect(sectorsAdjacent('5:5', '5:5')).toBe(false);
  });
});
