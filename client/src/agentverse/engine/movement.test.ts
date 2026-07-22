import { wanderTarget, stepToward } from './movement';
import { THEMES } from '../data/themes';

describe('wanderTarget / stepToward walkability', () => {
  const town = THEMES.town;
  const tamers = THEMES.tamers;
  const cyber = THEMES.cyberpunk; // no walkable box

  test('town: wander from PM home {3,3} never targets a water column (x < 2)', () => {
    for (let i = 0; i < 1000; i++) {
      const t = wanderTarget({ x: 3, y: 3 }, town);
      expect(t.x).toBeGreaterThanOrEqual(2);
      expect(t.x).toBeLessThanOrEqual(town.cols - 2);
      expect(t.y).toBeGreaterThanOrEqual(1);
      expect(t.y).toBeLessThanOrEqual(town.rows - 2);
    }
  });

  test('town: the L-path to any wander target never enters a water column', () => {
    for (let iter = 0; iter < 300; iter++) {
      let pos = { x: 3, y: 3 };
      const target = wanderTarget({ x: 3, y: 3 }, town);
      for (let s = 0; s < 50 && !(pos.x === target.x && pos.y === target.y); s++) {
        pos = stepToward(pos, target).pos;
        expect(pos.x).toBeGreaterThanOrEqual(2);
      }
    }
  });

  test('tamers: wander from backend home {3,7} never targets a water column (x < 3)', () => {
    for (let i = 0; i < 1000; i++) {
      const t = wanderTarget({ x: 3, y: 7 }, tamers);
      expect(t.x).toBeGreaterThanOrEqual(3);
    }
  });

  test('themes without a walkable box keep the original border clamp', () => {
    for (let i = 0; i < 500; i++) {
      const t = wanderTarget({ x: 1, y: 1 }, cyber);
      expect(t.x).toBeGreaterThanOrEqual(1);
      expect(t.x).toBeLessThanOrEqual(cyber.cols - 2);
      expect(t.y).toBeGreaterThanOrEqual(1);
      expect(t.y).toBeLessThanOrEqual(cyber.rows - 2);
    }
  });
});
