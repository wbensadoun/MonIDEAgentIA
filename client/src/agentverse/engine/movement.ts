import type { Facing, ThemeMeta, Vec2 } from '../types';

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

export function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function samePos(a: Vec2, b: Vec2): boolean {
  return Math.round(a.x) === Math.round(b.x) && Math.round(a.y) === Math.round(b.y);
}

/**
 * Pick a wander destination near `home`, kept one tile away from the borders so
 * agents never clip the world edge in any theme.
 */
export function wanderTarget(home: Vec2, theme: ThemeMeta, radius = 2): Vec2 {
  const x = clamp(home.x + randInt(-radius, radius), 1, theme.cols - 2);
  const y = clamp(home.y + randInt(-radius, radius), 1, theme.rows - 2);
  return { x, y };
}

/** One discrete grid step toward `target` (used by the town theme). */
export function stepToward(pos: Vec2, target: Vec2): { pos: Vec2; facing: Facing } {
  const dx = target.x - pos.x;
  const dy = target.y - pos.y;

  // Move along the dominant axis first — gives a natural L-shaped path.
  if (Math.abs(dx) >= Math.abs(dy) && dx !== 0) {
    return { pos: { x: pos.x + Math.sign(dx), y: pos.y }, facing: dx > 0 ? 'right' : 'left' };
  }
  if (dy !== 0) {
    return { pos: { x: pos.x, y: pos.y + Math.sign(dy) }, facing: dy > 0 ? 'down' : 'up' };
  }
  return { pos, facing: 'down' };
}

/** Facing for continuous themes, derived from travel direction. */
export function facingTo(pos: Vec2, target: Vec2): Facing {
  const dx = target.x - pos.x;
  const dy = target.y - pos.y;
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 'right' : 'left';
  return dy >= 0 ? 'down' : 'up';
}
