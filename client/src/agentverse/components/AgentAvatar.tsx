import React from 'react';
import type { AgentRoleKey, AvatarPalette, Facing } from '../types';

interface AgentAvatarProps {
  palette: AvatarPalette;
  facing: Facing;
  /** Render the blocky pixel sprite (town/RPG themes) instead of the flat one. */
  pixel: boolean;
  /** Drives the per-character look (hair, accessory, outfit cut). */
  roleKey?: AgentRoleKey;
  size?: number;
}

/* Per-character identity so the six agents read as distinct people rather than
 * palette swaps. Kept in sync with the Phaser town renderer. */
type HairStyle = 'bun' | 'long' | 'short' | 'bob' | 'beanie';
type AccStyle = 'glasses' | 'bigglasses' | 'headphones' | 'beard' | 'goggles' | 'none';
type OutfitStyle = 'blazer' | 'hoodie' | 'tee' | 'vest';
interface CharStyle { hair: HairStyle; acc: AccStyle; outfit: OutfitStyle; hatColor: string }

const CHAR: Record<string, CharStyle> = {
  pm: { hair: 'bun', acc: 'glasses', outfit: 'blazer', hatColor: '#46607a' },
  ux: { hair: 'long', acc: 'bigglasses', outfit: 'tee', hatColor: '#46607a' },
  frontend: { hair: 'short', acc: 'headphones', outfit: 'hoodie', hatColor: '#46607a' },
  backend: { hair: 'short', acc: 'beard', outfit: 'tee', hatColor: '#46607a' },
  qa: { hair: 'bob', acc: 'none', outfit: 'vest', hatColor: '#46607a' },
  devops: { hair: 'beanie', acc: 'goggles', outfit: 'tee', hatColor: '#46607a' },
};
const DEFAULT_CHAR: CharStyle = { hair: 'short', acc: 'none', outfit: 'tee', hatColor: '#46607a' };

/** Multiply a #rrggbb color toward black by `f` (0..1). */
function shade(hex: string, f: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const r = Math.round(((n >> 16) & 255) * f);
  const g = Math.round(((n >> 8) & 255) * f);
  const b = Math.round((n & 255) * f);
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

/** Add `amt` (0..255) to each channel of a #rrggbb color. */
function lighten(hex: string, amt: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const r = Math.min(255, ((n >> 16) & 255) + amt);
  const g = Math.min(255, ((n >> 8) & 255) + amt);
  const b = Math.min(255, (n & 255) + amt);
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

function AgentAvatarBase({ palette, facing, pixel, roleKey, size = 48 }: AgentAvatarProps) {
  const t = (roleKey && CHAR[roleKey]) || DEFAULT_CHAR;
  return pixel
    ? <PixelSprite palette={palette} facing={facing} size={size} t={t} />
    : <FlatAvatar palette={palette} facing={facing} size={size} t={t} />;
}

export const AgentAvatar = React.memo(AgentAvatarBase);

/* ------------------------------------------------------------------ */
/* Pixel sprite — parametric 16×20, per-role hair + accessory          */
/* ------------------------------------------------------------------ */

const PW = 16;
const PH = 20;
type Cell = { x: number; y: number; w: number; h: number; c: string };
const R = (x: number, y: number, w: number, h: number, c: string): Cell => ({ x, y, w, h, c });

function pixelCells(t: CharStyle, p: AvatarPalette, facing: Facing): Cell[] {
  if (facing === 'up') return pixelUp(t, p);
  if (facing === 'left' || facing === 'right') return pixelSide(t, p);
  return pixelDown(t, p);
}

function bodyBase(p: AvatarPalette, t: CharStyle): Cell[] {
  const ink = shade(p.outfit, 0.3);
  const cells: Cell[] = [];
  // silhouette outline (ink shows 1px around the inset fills)
  cells.push(R(3, 2, 10, 15, ink));
  cells.push(R(4, 16, 3, 4, ink), R(9, 16, 3, 4, ink));
  // legs
  cells.push(R(5, 16, 2, 2, '#3b4152'), R(9, 16, 2, 2, '#3b4152'));
  cells.push(R(4, 18, 3, 1, '#20242f'), R(9, 18, 3, 1, '#20242f'));
  // torso
  cells.push(R(4, 10, 8, 6, p.outfit));
  cells.push(R(5, 10, 3, 1, lighten(p.outfit, 26)));
  cells.push(R(4, 15, 8, 1, shade(p.outfit, 0.72)));
  // outfit cut detail
  if (t.outfit === 'blazer') {
    cells.push(R(6, 10, 4, 3, '#f4f1ea'));
    cells.push(R(7, 10, 2, 5, p.accent));
  } else if (t.outfit === 'hoodie') {
    cells.push(R(4, 10, 8, 1, shade(p.outfit, 0.8)));
    cells.push(R(6, 11, 1, 3, '#eef2f4'), R(9, 11, 1, 3, '#eef2f4'));
  } else if (t.outfit === 'vest') {
    cells.push(R(5, 10, 1, 6, shade(p.outfit, 0.62)), R(10, 10, 1, 6, shade(p.outfit, 0.62)));
    cells.push(R(6, 10, 4, 2, '#f4f1ea'));
  } else {
    cells.push(R(6, 10, 4, 1, lighten(p.outfit, 18)));
  }
  return cells;
}

function pixelDown(t: CharStyle, p: AvatarPalette): Cell[] {
  const skinDk = shade(p.skin, 0.84);
  const cells = bodyBase(p, t);
  // head
  cells.push(R(4, 3, 8, 6, p.skin));
  cells.push(R(4, 8, 8, 1, skinDk));
  cells.push(R(3, 5, 1, 2, p.skin), R(12, 5, 1, 2, p.skin)); // ears
  // eyes + mouth
  cells.push(R(5, 6, 2, 1, '#ffffff'), R(9, 6, 2, 1, '#ffffff'));
  cells.push(R(6, 6, 1, 1, '#1d1f29'), R(9, 6, 1, 1, '#1d1f29'));
  cells.push(R(7, 8, 2, 1, skinDk));
  pushHairDown(cells, t, p.hair);
  pushAccDown(cells, t, p.hair);
  return cells;
}

function pushHairDown(cells: Cell[], t: CharStyle, hair: string): void {
  const hi = lighten(hair, 38);
  switch (t.hair) {
    case 'bun':
      cells.push(R(6, 0, 4, 3, hair), R(7, 1, 1, 1, hi));
      cells.push(R(4, 2, 8, 2, hair));
      cells.push(R(4, 3, 1, 3, hair), R(11, 3, 1, 3, hair));
      cells.push(R(5, 2, 5, 1, hi));
      break;
    case 'long':
      cells.push(R(4, 1, 8, 3, hair));
      cells.push(R(3, 3, 1, 9, hair), R(12, 3, 1, 9, hair));
      cells.push(R(4, 3, 1, 2, hair), R(11, 3, 1, 2, hair));
      cells.push(R(5, 1, 4, 1, hi), R(3, 5, 1, 6, hi));
      break;
    case 'short':
      cells.push(R(4, 2, 8, 2, hair));
      cells.push(R(5, 1, 1, 1, hair), R(7, 1, 1, 1, hair), R(10, 1, 1, 1, hair));
      cells.push(R(4, 3, 1, 2, hair), R(11, 3, 1, 2, hair));
      cells.push(R(5, 2, 5, 1, hi));
      break;
    case 'bob':
      cells.push(R(4, 1, 8, 3, hair));
      cells.push(R(3, 3, 1, 5, hair), R(12, 3, 1, 5, hair));
      cells.push(R(5, 1, 5, 1, hi));
      break;
    case 'beanie':
      cells.push(R(4, 0, 8, 4, t.hatColor), R(5, 0, 6, 1, lighten(t.hatColor, 28)));
      cells.push(R(4, 4, 8, 1, shade(t.hatColor, 0.66)));
      cells.push(R(4, 5, 1, 1, hair), R(11, 5, 1, 1, hair));
      break;
    default:
      cells.push(R(4, 2, 8, 2, hair));
  }
}

function pushAccDown(cells: Cell[], t: CharStyle, hair: string): void {
  switch (t.acc) {
    case 'glasses':
      cells.push(R(5, 6, 2, 1, '#2a2f3a'), R(9, 6, 2, 1, '#2a2f3a'), R(8, 6, 1, 1, '#2a2f3a'));
      break;
    case 'bigglasses':
      cells.push(R(4, 5, 3, 3, '#37313f'), R(9, 5, 3, 3, '#37313f'));
      cells.push(R(5, 6, 1, 1, '#cfe9ff'), R(10, 6, 1, 1, '#cfe9ff'));
      break;
    case 'headphones':
      cells.push(R(4, 1, 8, 1, '#242424'));
      cells.push(R(2, 3, 1, 3, '#242424'), R(13, 3, 1, 3, '#242424'));
      cells.push(R(2, 4, 1, 1, '#ff5d8f'), R(13, 4, 1, 1, '#ff5d8f'));
      break;
    case 'beard':
      cells.push(R(5, 8, 6, 2, hair));
      cells.push(R(4, 7, 1, 2, hair), R(11, 7, 1, 2, hair));
      break;
    case 'goggles':
      cells.push(R(4, 3, 8, 1, '#4a3320'));
      cells.push(R(5, 1, 2, 2, '#7a5230'), R(9, 1, 2, 2, '#7a5230'));
      cells.push(R(5, 1, 1, 1, '#9fe8ff'), R(9, 1, 1, 1, '#9fe8ff'));
      break;
    default:
      break;
  }
}

function pixelSide(t: CharStyle, p: AvatarPalette): Cell[] {
  // Drawn facing right; the left facing is mirrored by the SVG transform.
  const skinDk = shade(p.skin, 0.84);
  const hair = p.hair;
  const hi = lighten(hair, 36);
  const cells = bodyBase(p, t);
  cells.push(R(4, 3, 8, 6, p.skin));
  cells.push(R(4, 8, 8, 1, skinDk));
  cells.push(R(9, 6, 2, 1, '#ffffff'), R(10, 6, 1, 1, '#1d1f29')); // eye toward front
  cells.push(R(10, 8, 1, 1, skinDk)); // mouth
  switch (t.hair) {
    case 'bun':
      cells.push(R(4, 2, 8, 3, hair), R(3, 1, 3, 3, hair));
      cells.push(R(4, 4, 2, 4, hair));
      break;
    case 'long':
      cells.push(R(4, 1, 8, 3, hair), R(3, 3, 3, 11, hair));
      cells.push(R(3, 4, 1, 8, hi));
      break;
    case 'short':
      cells.push(R(4, 2, 8, 2, hair), R(4, 1, 3, 1, hair), R(4, 4, 2, 2, hair));
      break;
    case 'bob':
      cells.push(R(4, 1, 8, 3, hair), R(3, 3, 3, 6, hair));
      break;
    case 'beanie':
      cells.push(R(4, 0, 8, 4, t.hatColor), R(4, 4, 8, 1, shade(t.hatColor, 0.66)));
      break;
    default:
      cells.push(R(4, 2, 8, 2, hair));
  }
  if (t.acc === 'glasses' || t.acc === 'bigglasses') cells.push(R(9, 6, 3, 1, '#2a2f3a'));
  if (t.acc === 'headphones') {
    cells.push(R(4, 1, 8, 1, '#242424'), R(3, 3, 2, 4, '#242424'), R(3, 4, 1, 2, '#ff5d8f'));
  }
  if (t.acc === 'beard') cells.push(R(8, 8, 4, 2, hair), R(11, 6, 1, 3, hair));
  if (t.acc === 'goggles') cells.push(R(4, 3, 8, 1, '#4a3320'), R(9, 1, 2, 2, '#7a5230'));
  return cells;
}

function pixelUp(t: CharStyle, p: AvatarPalette): Cell[] {
  const hair = p.hair;
  const hi = lighten(hair, 28);
  const cells = bodyBase(p, t);
  cells.push(R(4, 6, 8, 3, p.skin)); // nape
  cells.push(R(4, 3, 8, 5, hair));
  switch (t.hair) {
    case 'bun':
      cells.push(R(6, 1, 4, 3, hair), R(7, 2, 2, 1, hi));
      break;
    case 'long':
      cells.push(R(3, 3, 2, 11, hair), R(11, 3, 2, 11, hair), R(4, 2, 8, 6, hair));
      break;
    case 'bob':
      cells.push(R(3, 2, 10, 7, hair));
      break;
    case 'beanie':
      cells.push(R(4, 1, 8, 5, t.hatColor), R(4, 5, 8, 1, shade(t.hatColor, 0.66)));
      break;
    default:
      cells.push(R(4, 2, 8, 2, hair), R(5, 3, 6, 1, hi));
  }
  if (t.acc === 'headphones') {
    cells.push(R(4, 1, 8, 1, '#242424'), R(2, 3, 1, 4, '#242424'), R(13, 3, 1, 4, '#242424'));
  }
  if (t.acc === 'goggles') cells.push(R(4, 3, 8, 1, '#4a3320'));
  return cells;
}

function PixelSprite({ palette, facing, size, t }: { palette: AvatarPalette; facing: Facing; size: number; t: CharStyle }) {
  const cells = pixelCells(t, palette, facing);
  return (
    <svg
      className="av-sprite"
      width={size}
      height={size * (PH / PW)}
      viewBox={`0 0 ${PW} ${PH}`}
      shapeRendering="crispEdges"
      style={{ transform: facing === 'left' ? 'scaleX(-1)' : undefined } as React.CSSProperties}
      aria-hidden
    >
      {cells.map((c, i) => (
        <rect key={i} x={c.x} y={c.y} width={c.w + 0.02} height={c.h + 0.02} fill={c.c} />
      ))}
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* Flat vector avatar — per-role hair + accessories                    */
/* ------------------------------------------------------------------ */

function FlatAvatar({ palette, facing, size, t }: { palette: AvatarPalette; facing: Facing; size: number; t: CharStyle }) {
  const up = facing === 'up';
  const hair = palette.hair;
  const hairHi = lighten(hair, 26);
  const ink = shade(palette.outfit, 0.45);
  const eyes = facing === 'down'
    ? [[19, 21], [29, 21]]
    : facing === 'right'
      ? [[28, 21]]
      : facing === 'left'
        ? [[20, 21]]
        : [];

  return (
    <svg
      className="av-flat"
      width={size}
      height={size * (60 / 48)}
      viewBox="0 0 48 60"
      style={{ transform: facing === 'left' ? 'scaleX(-1)' : undefined } as React.CSSProperties}
      aria-hidden
    >
      <ellipse cx="24" cy="56" rx="14" ry="3.6" fill="rgba(0,0,0,0.22)" />

      {/* long hair sits behind the body */}
      {t.hair === 'long' && !up && (
        <path d="M9 18 Q7 40 12 48 L16 48 Q13 32 15 19 Z M39 18 Q41 40 36 48 L32 48 Q35 32 33 19 Z" fill={hair} />
      )}

      {/* body */}
      <path d="M11 56 Q11 33 24 33 Q37 33 37 56 Z" fill={palette.outfit} />
      <path d="M11 56 Q11 33 24 33 Q37 33 37 56 Z" fill="none" stroke={ink} strokeWidth="1.4" />
      {renderOutfit(t, palette, ink)}

      {/* neck + head */}
      <rect x="21" y="27" width="6" height="8" rx="2" fill={palette.skin} />
      <circle cx="24" cy="19" r="12" fill={palette.skin} />
      <path d="M12 21 Q12 32 24 32 Q36 32 36 21" fill="none" stroke={shade(palette.skin, 0.86)} strokeWidth="0.8" opacity="0.6" />

      {renderHair(t, hair, hairHi, up)}
      {!up && renderAccessory(t, palette, hair)}

      {eyes.map(([cx, cy], i) => (
        <circle key={i} cx={cx} cy={cy} r="1.7" fill="#22242e" />
      ))}
    </svg>
  );
}

function renderOutfit(t: CharStyle, p: AvatarPalette, ink: string) {
  if (t.outfit === 'blazer') {
    return (
      <>
        <path d="M20 33 L24 44 L28 33 Z" fill="#f4f1ea" />
        <path d="M23 34 L25 34 L24.5 45 L23.5 45 Z" fill={p.accent} />
        <path d="M16 34 L20 33 L21 40 Z M32 34 L28 33 L27 40 Z" fill={shade(p.outfit, 0.7)} />
      </>
    );
  }
  if (t.outfit === 'hoodie') {
    return (
      <>
        <path d="M14 35 Q24 30 34 35 L34 38 Q24 33 14 38 Z" fill={shade(p.outfit, 0.78)} />
        <rect x="21" y="35" width="1.4" height="9" rx="0.7" fill="#eef2f4" />
        <rect x="25.6" y="35" width="1.4" height="9" rx="0.7" fill="#eef2f4" />
        <rect x="19" y="46" width="10" height="5" rx="1.5" fill={lighten(p.outfit, 12)} />
      </>
    );
  }
  if (t.outfit === 'vest') {
    return (
      <>
        <path d="M19 33 L19 54 M29 33 L29 54" stroke={shade(p.outfit, 0.6)} strokeWidth="2.4" fill="none" />
        <path d="M21 33 L24 39 L27 33 Z" fill="#f4f1ea" />
      </>
    );
  }
  return <ellipse cx="24" cy="35" rx="6" ry="2" fill={lighten(p.outfit, 16)} />;
}

function renderHair(t: CharStyle, hair: string, hi: string, up: boolean) {
  switch (t.hair) {
    case 'bun':
      return (
        <>
          <circle cx="24" cy="7" r="4.5" fill={hair} />
          <circle cx="22.6" cy="6" r="1.4" fill={hi} />
          <path d="M12 18 Q12 6 24 6 Q36 6 36 18 Q36 13 30 12 Q24 9 18 12 Q12 13 12 18 Z" fill={hair} />
        </>
      );
    case 'long':
      return (
        <>
          <path d="M11 22 Q11 4 24 4 Q37 4 37 22 Q37 14 30 12 Q24 9 18 12 Q11 14 11 22 Z" fill={hair} />
          <path d="M13 8 Q20 6 24 7" stroke={hi} strokeWidth="1.2" fill="none" opacity="0.7" />
        </>
      );
    case 'short':
      return (
        <path
          d={up
            ? 'M12 22 Q12 4 24 4 Q36 4 36 22 Q30 16 24 16 Q18 16 12 22 Z'
            : 'M12 19 Q12 5 24 5 Q36 5 36 19 Q34 12 30 13 L29 9 L25 13 L23 8 L20 13 L17 10 L16 14 Q13 13 12 19 Z'}
          fill={hair}
        />
      );
    case 'bob':
      return (
        <path d="M11 24 Q11 4 24 4 Q37 4 37 24 L37 20 Q37 12 30 11 Q24 9 18 11 Q11 12 11 20 Z" fill={hair} />
      );
    case 'beanie':
      return (
        <>
          <path d="M11 17 Q11 3 24 3 Q37 3 37 17 Z" fill={t.hatColor} />
          <rect x="11" y="15" width="26" height="4" rx="2" fill={shade(t.hatColor, 0.7)} />
          <circle cx="24" cy="3" r="2" fill={lighten(t.hatColor, 30)} />
        </>
      );
    default:
      return <path d="M12 20 Q12 5 24 5 Q36 5 36 20 Q30 15 24 15 Q18 15 12 20 Z" fill={hair} />;
  }
}

function renderAccessory(t: CharStyle, p: AvatarPalette, hair: string) {
  switch (t.acc) {
    case 'glasses':
      return (
        <g stroke="#2a2f3a" strokeWidth="1.3" fill="rgba(190,233,255,0.55)">
          <rect x="15.5" y="18" width="6" height="5" rx="2" />
          <rect x="26.5" y="18" width="6" height="5" rx="2" />
          <line x1="21.5" y1="20" x2="26.5" y2="20" />
        </g>
      );
    case 'bigglasses':
      return (
        <g stroke="#37313f" strokeWidth="1.6" fill="rgba(255,227,243,0.5)">
          <circle cx="18.5" cy="20.5" r="4" />
          <circle cx="29.5" cy="20.5" r="4" />
          <line x1="22.5" y1="20.5" x2="25.5" y2="20.5" />
        </g>
      );
    case 'headphones':
      return (
        <g>
          <path d="M11 19 Q11 7 24 7 Q37 7 37 19" stroke="#242424" strokeWidth="2.4" fill="none" />
          <rect x="8.5" y="17" width="5" height="8" rx="2.2" fill="#242424" />
          <rect x="34.5" y="17" width="5" height="8" rx="2.2" fill="#242424" />
          <rect x="9.6" y="19" width="1.4" height="4" fill="#ff5d8f" />
        </g>
      );
    case 'beard':
      return (
        <path d="M14 20 Q15 30 24 31 Q33 30 34 20 Q31 27 24 27 Q17 27 14 20 Z" fill={hair} opacity="0.95" />
      );
    case 'goggles':
      return (
        <g>
          <rect x="12" y="11" width="24" height="3.5" rx="1.5" fill="#4a3320" />
          <circle cx="18" cy="11" r="3" fill="#7a5230" stroke="#3a2818" strokeWidth="1" />
          <circle cx="30" cy="11" r="3" fill="#7a5230" stroke="#3a2818" strokeWidth="1" />
          <circle cx="17" cy="10" r="1" fill="#9fe8ff" />
          <circle cx="29" cy="10" r="1" fill="#9fe8ff" />
        </g>
      );
    default:
      return null;
  }
}
