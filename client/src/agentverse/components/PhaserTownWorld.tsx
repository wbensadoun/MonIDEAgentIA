/**
 * Monster Town — Phaser scene backed by the Kenney Roguelike/RPG Pack (CC0).
 * Spritesheet: /assets/town/kenney_overworld.png (57 cols x 31 rows, 32px/tile, 2px spacing).
 *
 * Layers (bottom to top):
 *   L0 GROUND   — grass / water / dirt paths
 *   L1 DETAIL   — flowers, tall grass, ground deco
 *   L2 OVERLAY  — tree canopies + roof tops (depth > player → player walks under trees)
 *
 * Agent sprites keep depth = pixel_y, so they sort correctly behind trees.
 */
import React, { useEffect, useRef } from 'react';
import Phaser from 'phaser';
import type { Agent, Facing, ThemeMeta } from '../types';

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

interface PhaserTownWorldProps {
  agents: Agent[];
  theme: ThemeMeta;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onDeselect: () => void;
}

/* ── Map constants ──────────────────────────────────────────────────────── */
const TILE = 32;
const COLS = 16;
const ROWS = 11;
const WORLD_W = COLS * TILE; // 512
const WORLD_H = ROWS * TILE; // 352

/* ── Tileset constants ──────────────────────────────────────────────────── */
// Kenney Roguelike/RPG pack — 57 cols x 31 rows, tile 32px, spacing 2px
// IDs are 1-based (Phaser/Tiled convention). 0 = empty.
// col = (id-1) % 57,  row = Math.floor((id-1) / 57)
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- reference tile-atlas table, kept for future use
const T = {
  // Row 0: outdoor ground
  WATER: 1,        // col 0 — teal water (99,197,207)
  WATER2: 2,       // col 1 — teal water variant
  GRASS: 3,        // col 2 — medium green (133,183,140)
  GRASS2: 5,       // col 4 — medium green variant
  GRASS3: 6,       // col 5 — bright green
  GRASS_DK: 56,    // col 55 — darker green
  PATH: 17,        // col 16 — dirt path brown (170,128,86)
  PATH2: 18,       // col 17 — path variant
  PATH3: 19,       // col 18 — path variant
  PATH4: 20,       // col 19 — path variant
  STONE: 8,        // col 7 — light stone/grey
  STONE2: 10,      // col 9 — light stone
  // Row 1-5: water+grass transitions (top-left cluster)
  W_GRASS_TL: 58,  // col 0, row 1 — teal/green mix (top-left of autotile)
  W_GRASS_T: 59,   // col 1, row 1
  W_GRASS_TR: 60,  // col 2, row 1 — transition
  W_GRASS_ML: 115, // col 0, row 2
  W_GRASS_MR: 116, // col 1, row 2
  W_GRASS_BL: 172, // col 0, row 3
  W_GRASS_B: 173,  // col 1, row 3
  W_GRASS_C: 174,  // col 2, row 3 — mixed
  // Row 6: vegetation clusters
  BUSH1: 344,      // col 1, row 6 — green bush (135,155,55)
  BUSH2: 401,      // col 1, row 7 — bush variant
  // Flower tiles (row 6 col 49-55)
  FLOWER1: 392,    // col 49, row 6 — bright green (flower patch)
  FLOWER2: 393,    // col 50, row 6
  FLOWER3: 394,    // col 51, row 6
} as const;

/* ── Ground map: 16 cols x 11 rows ─────────────────────────────────────── */
// FireRed-style layout: water top-left, grass centre, dirt paths connecting zones
const GROUND: number[][] = [
//   0  1  2  3  4  5  6  7  8  9 10 11 12 13 14 15
  [  1, 1, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3 ], // 0
  [  1, 1, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3 ], // 1
  [  1, 1, 3, 3,17,17,17,17,17,17,17,17,17,17, 3, 3 ], // 2 — upper H-path
  [  1, 1, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3 ], // 3
  [  1, 3, 3, 3, 3, 3,17, 3, 3, 3,17, 3, 3, 3, 3, 3 ], // 4 — verticals
  [  3, 3, 3, 3, 3, 3,17, 3, 3, 3,17, 3, 3, 3, 3, 3 ], // 5
  [  3, 3, 3, 3, 3, 3,17, 3, 3, 3,17, 3, 3, 3, 3, 3 ], // 6
  [  3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3 ], // 7
  [  3, 3, 3, 3,17,17,17,17,17,17,17,17,17,17, 3, 3 ], // 8 — lower H-path
  [  3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3 ], // 9
  [  3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3 ], // 10
];

/* ── Detail map (flowers / tall-grass overlay — below player) ─────────── */
// 0 = empty tile (transparent), otherwise a Kenney deco tile
const DETAIL: number[][] = [
  [  0, 0, 0, 0, 0, 0, 0, 0, 0,392, 0, 0, 0, 0, 0, 0 ],
  [  0, 0, 0, 0, 0,392, 0, 0, 0, 0, 0, 0, 0,393, 0, 0 ],
  [  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0 ],
  [  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,394 ],
  [  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0 ],
  [  0, 0, 0,392, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,393, 0 ],
  [  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0 ],
  [  0, 0,393, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0 ],
  [  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0 ],
  [  0, 0, 0, 0, 0, 0,392, 0, 0, 0, 0, 0, 0, 0, 0, 0 ],
  [  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,393, 0, 0, 0, 0 ],
];

/* ── Tree positions [gridX, gridY] ─────────────────────────────────────── */
const TREES: [number, number][] = [
  [0.5, 0.3], [0.5, 2.1], [0.6, 4.2], [0.5, 6.8], [0.5, 8.8],
  [1.1, 9.8], [2.3, 9.2], [4.3, 9.8], [5.6, 9.9],
  [9.9, 0.3], [11.9, 0.3], [13.8, 0.4], [14.7, 0.3],
  [15.2, 0.8], [15.3, 3.2], [15.1, 5.9], [15.2, 9.1],
  [14.6, 9.8], [13.4, 9.8], [2.2, 0.4],
];

/* ── Sign positions [gridX, gridY, label] ──────────────────────────────── */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- reference data, not yet wired
const SIGNS: [number, number, string][] = [
  [4.8, 2.6, 'Lab IA'],
  [5.0, 7.4, 'Atelier'],
];

/* ── Water-edge fences (bridge) ─────────────────────────────────────────── */
// pairs of [gx, gy] where bridge tiles go
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- reference data, not yet wired
const BRIDGES: [number, number][] = [
  [1.8, 5.5], [1.8, 6.5],
];

/* ── Phaser agent bundle ─────────────────────────────────────────────────── */
interface PendingSync {
  agents: Agent[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onDeselect: () => void;
}

interface AgentBundle {
  container: Phaser.GameObjects.Container;
  sprite: Phaser.GameObjects.Sprite;
  shadow: Phaser.GameObjects.Ellipse;
  ring: Phaser.GameObjects.Graphics;
  name: Phaser.GameObjects.Text;
  role: Phaser.GameObjects.Text;
  barBg: Phaser.GameObjects.Rectangle;
  barFill: Phaser.GameObjects.Rectangle;
  bubble: Phaser.GameObjects.Container | null;
  bubbleId: string | null;
  currentAnim: string | null;
  lastAgent: Agent;
}

function hexToNum(c: string): number { return parseInt(c.replace('#', ''), 16); }
function shorten(t: string, n = 18): string { return t.length > n ? t.slice(0, n - 1) + '.' : t; }
function pixelPos(agent: Agent) {
  return { x: (agent.pos.x + 0.5) * TILE, y: (agent.pos.y + 0.64) * TILE };
}

/* ── Phaser scene ────────────────────────────────────────────────────────── */
class TownScene extends Phaser.Scene {
  private bundles = new Map<string, AgentBundle>();
  private pending: PendingSync | null = null;
  private isReady = false;
  private onSelect?: (id: string) => void;
  private onDeselect?: () => void;
  private dayNight?: Phaser.GameObjects.Rectangle;
  private reduced = false;

  constructor() { super({ key: 'agentverse-town-kenney' }); }

  preload(): void {
    this.load.spritesheet('kenney', 'assets/town/kenney_overworld.png', {
      frameWidth: 32, frameHeight: 32, spacing: 2,
    });
  }

  create(): void {
    this.reduced = prefersReducedMotion();
    this.cameras.main.setBackgroundColor('#4a9e3c');

    this.buildTilemap();
    this.paintDecoration();
    this.paintZoneLabels();
    this.applyGbaGrade();
    this.dayNight = this.buildDayNight();

    this.input.on('pointerdown',
      (_p: Phaser.Input.Pointer, over: Phaser.GameObjects.GameObject[]) => {
        if (!over.length) this.onDeselect?.();
      });

    this.isReady = true;
    if (this.pending) {
      const p = this.pending; this.pending = null;
      this.sync(p.agents, p.selectedId, p.onSelect, p.onDeselect);
    }
  }

  update(time: number): void {
    this.bundles.forEach((b) => {
      if (b.lastAgent.status === 'working' && b.lastAgent.progress < 0) {
        b.barFill.width = this.reduced ? 24 : 10 + ((Math.sin(time / 200) + 1) / 2) * 24;
      }
      b.sprite.y = (!this.reduced && b.lastAgent.status === 'talking')
        ? -1 + Math.sin(time / 200) * 1.5
        : 0;
    });

    // ── Ambient day/night drift (gentle, full cycle ~150s, starts at day) ──
    if (this.dayNight && !this.reduced) {
      const period = 150000;
      const phase = (time % period) / period;             // 0..1
      const night = (1 - Math.cos(phase * Math.PI * 2)) / 2; // 0 (day) → 1 (night) → 0
      const r = Math.round(255 - night * 80);
      const g = Math.round(255 - night * 64);
      const b = Math.round(255 - night * 16);
      this.dayNight.setFillStyle((r << 16) | (g << 8) | b, 1);
    }
  }

  /* ── GBA cartridge color grade + handheld-screen vignette (WebGL) ──────── */
  private applyGbaGrade(): void {
    const cam = this.cameras.main;
    if (!cam.filters) return;
    try {
      // Punchy, slightly warm saturation + contrast → Kenney tiles pop like a GBA cart
      const cm = cam.filters.internal.addColorMatrix();
      cm.colorMatrix.saturate(0.22, true).contrast(0.10, true);
      // Soft frame darkening, like looking at a handheld screen
      cam.filters.internal.addVignette(0.5, 0.5, 0.62, 0.42);
      // Very subtle CRT bulge
      cam.filters.internal.addBarrel(1.03);
    } catch {
      /* WebGL filters unavailable — world still renders, just ungraded */
    }
  }

  /* ── Full-screen multiply overlay driving the day/night tint ───────────── */
  private buildDayNight(): Phaser.GameObjects.Rectangle {
    const r = this.add.rectangle(WORLD_W / 2, WORLD_H / 2, WORLD_W, WORLD_H, 0xffffff, 1);
    r.setScrollFactor(0);
    r.setDepth(50000);
    r.setBlendMode(Phaser.BlendModes.MULTIPLY);
    return r;
  }

  sync(agents: Agent[], selectedId: string | null,
    onSelect: (id: string) => void, onDeselect: () => void): void {
    this.onSelect = onSelect; this.onDeselect = onDeselect;
    if (!this.isReady) { this.pending = { agents, selectedId, onSelect, onDeselect }; return; }
    const ids = new Set(agents.map((a) => a.id));
    this.bundles.forEach((b, id) => { if (!ids.has(id)) { b.container.destroy(); this.bundles.delete(id); } });
    agents.forEach((a) => {
      const b = this.bundles.get(a.id) ?? this.createBundle(a);
      this.updateBundle(b, a, selectedId === a.id);
    });
  }

  /* ── Tilemap ─────────────────────────────────────────────────────────── */
  private buildTilemap(): void {
    const data: number[][][] = [GROUND, DETAIL];

    data.forEach((layerData, li) => {
      const flatData = layerData.map(row =>
        row.map(id => id === 0 ? -1 : id - 1),  // 0 = empty → -1 for Phaser
      );
      const map = this.make.tilemap({ data: flatData, tileWidth: TILE, tileHeight: TILE });
      const tiles = map.addTilesetImage('kenney', undefined, TILE, TILE, 0, 2);
      if (!tiles) return;
      const layer = map.createLayer(0, tiles, 0, 0);
      if (!layer) return;
      layer.setDepth(li);  // ground=0, detail=1 (both below player)
    });
  }

  /* ── Trees, signs, bridges ───────────────────────────────────────────── */
  private paintDecoration(): void {
    // ── Trees (procedural — Pokémon FireRed style) ──
    TREES.forEach(([gx, gy]) => {
      const wpx = gx * TILE;
      const wpy = gy * TILE;
      const baseDepth = wpy + TILE;

      // Shadow ellipse on ground
      const shadow = this.add.ellipse(wpx, wpy + TILE * 0.9, TILE * 0.9, TILE * 0.22, 0x000000, 0.18);
      shadow.setDepth(baseDepth - 1);

      // Trunk
      const trunkG = this.add.graphics();
      trunkG.fillStyle(0x6b4726, 1);
      trunkG.fillRect(wpx - 5, wpy + TILE * 0.42, 10, TILE * 0.58);
      trunkG.fillStyle(0x8b5d34, 1);
      trunkG.fillRect(wpx - 3, wpy + TILE * 0.42, 4, TILE * 0.54);
      trunkG.setDepth(baseDepth);

      // Canopy — always ABOVE all agents (depth 9000+)
      const canopyDepth = 9000 + wpy;
      const cg = this.add.graphics();

      // Dark shadow layer of canopy
      cg.fillStyle(0x1f5e31, 1);
      cg.fillCircle(wpx, wpy - TILE * 0.05, TILE * 0.52);
      // Main canopy layers (lighter toward top-left = light source)
      cg.fillStyle(0x2f8a45, 1);
      cg.fillCircle(wpx - 3, wpy - TILE * 0.1, TILE * 0.44);
      cg.fillStyle(0x3aa653, 1);
      cg.fillCircle(wpx + 2, wpy - TILE * 0.18, TILE * 0.34);
      // Highlight
      cg.fillStyle(0x91d477, 1);
      cg.fillCircle(wpx - 4, wpy - TILE * 0.28, TILE * 0.14);

      // Outline ring
      cg.lineStyle(2, 0x1a3d1a, 0.7);
      cg.strokeCircle(wpx, wpy - TILE * 0.05, TILE * 0.52);

      cg.setDepth(canopyDepth);
    });

    // ── Station desks (one per agent home) ──
    [
      [3.2, 3.9], [7.2, 3.9], [12.2, 3.9],
      [3.2, 7.9], [7.2, 7.9], [12.2, 7.9],
    ].forEach(([gx, gy]) => {
      const wpx = gx * TILE;
      const wpy = gy * TILE;
      const g = this.add.graphics();

      // Desk surface
      g.fillStyle(0xba7a3e, 1);
      g.fillRoundedRect(wpx - 18, wpy - 10, 36, 18, 3);
      // Desk highlight
      g.fillStyle(0xd4924e, 1);
      g.fillRoundedRect(wpx - 16, wpy - 9, 20, 6, 2);
      // Monitor glow
      g.fillStyle(0x1a2a3a, 1);
      g.fillRoundedRect(wpx - 8, wpy - 22, 16, 13, 2);
      g.fillStyle(0x3090ff, 1);
      g.fillRoundedRect(wpx - 6, wpy - 20, 12, 9, 1);
      g.fillStyle(0x80c8ff, 1);
      g.fillRect(wpx - 5, wpy - 19, 5, 2);
      // Monitor stand
      g.fillStyle(0x2a1e10, 1);
      g.fillRect(wpx - 2, wpy - 9, 4, 3);

      // Outline
      g.lineStyle(2, 0x2a1e10, 0.8);
      g.strokeRoundedRect(wpx - 18, wpy - 10, 36, 18, 3);
      g.strokeRoundedRect(wpx - 8, wpy - 22, 16, 13, 2);

      g.setDepth(wpy * TILE + 5);
    });

    // ── Water edge fence (thin line along col 2) ──
    const fenceG = this.add.graphics();
    fenceG.lineStyle(3, 0x8b6a3e, 0.9);
    fenceG.strokeRect(TILE * 2 - 1, 0, 0, ROWS * TILE);
    fenceG.lineStyle(2, 0xa07848, 0.6);
    for (let r = 0; r < ROWS; r++) {
      fenceG.fillStyle(0x6b4726, 1);
      fenceG.fillRect(TILE * 2 - 4, r * TILE + 8, 6, 8);
      fenceG.fillRect(TILE * 2 - 4, r * TILE + TILE - 8, 6, 8);
    }
    fenceG.setDepth(2);

    // ── Water shimmer sparkles (animated) ──
    if (!this.reduced) {
      const sparkles: Phaser.GameObjects.Graphics[] = [];
      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < 2; c++) {
          const sg = this.add.graphics();
          sg.setDepth(3);
          sparkles.push(sg);
          const baseX = c * TILE + Math.random() * TILE;
          const baseY = r * TILE + Math.random() * TILE;
          (sg as unknown as { _bx: number; _by: number })._bx = baseX;
          (sg as unknown as { _bx: number; _by: number })._by = baseY;
        }
      }
      let sparkleTime = 0;
      this.time.addEvent({
        delay: 400,
        loop: true,
        callback: () => {
          sparkleTime += 0.4;
          sparkles.forEach((sg, i) => {
            const data = sg as unknown as { _bx: number; _by: number };
            sg.clear();
            const phase = (sparkleTime + i * 0.6) % (Math.PI * 2);
            if (Math.sin(phase) > 0.5) {
              sg.fillStyle(0xffffff, 0.5 + Math.sin(phase) * 0.3);
              sg.fillRect(data._bx - 2, data._by - 2, 4, 2);
            }
          });
        },
      });
    }
  }

  private paintZoneLabels(): void {
    [
      ['Village', 2.0, 0.4],
      ['Lab IA', 2.2, 3.4],
      ['Route Nord', 12.2, 0.4],
      ['Atelier', 2.6, 5.9],
      ['Prairie QA', 7.3, 5.9],
      ['Station', 12.5, 5.9],
    ].forEach(([text, x, y]) => {
      const lbl = this.add.text(
        (x as number) * TILE,
        (y as number) * TILE,
        text as string,
        {
          fontFamily: 'Courier New, monospace',
          fontSize: '9px',
          color: '#fff8d9',
          backgroundColor: '#2f2618',
          padding: { left: 4, right: 4, top: 2, bottom: 2 },
        },
      );
      lbl.setOrigin(0.5, 0.5);
      lbl.setDepth(12);
      lbl.setResolution(2);
    });
  }

  /* ── Agent bundles ───────────────────────────────────────────────────── */
  private ensureTextures(agent: Agent): void {
    const base = `agent-ktown-${agent.id}`;
    (['down', 'up', 'left', 'right'] as Facing[]).forEach((facing) => {
      [0, 1, 2, 3].forEach((frame) => {
        const key = `${base}-${facing}-${frame}`;
        if (this.textures.exists(key)) return;
        const canvas = document.createElement('canvas');
        canvas.width = 32; canvas.height = 42;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.imageSmoothingEnabled = false;
        this.drawAgentPixels(ctx, agent, facing, frame);
        this.textures.addCanvas(key, canvas);
      });

      const idle = `${base}-${facing}-idle`;
      const walk = `${base}-${facing}-walk`;
      if (!this.anims.exists(idle)) {
        this.anims.create({
          key: idle,
          frames: [
            { key: `${base}-${facing}-0`, duration: 1200 },
            { key: `${base}-${facing}-3`, duration: 140 },
          ],
          frameRate: 2, repeat: -1,
        });
      }
      if (!this.anims.exists(walk)) {
        this.anims.create({
          key: walk,
          frames: [
            { key: `${base}-${facing}-0` }, { key: `${base}-${facing}-1` },
            { key: `${base}-${facing}-0` }, { key: `${base}-${facing}-2` },
          ],
          frameRate: 8, repeat: -1,
        });
      }
    });
  }

  // Character sprite drawing (Kenney-palette-inspired pixel avatar)
  private drawAgentPixels(
    ctx: CanvasRenderingContext2D, agent: Agent,
    facing: Facing, frame: number,
  ): void {
    const walkShift = frame === 1 ? 2 : frame === 2 ? -2 : 0;
    const blink = frame === 3;
    const skin = agent.palette.skin;
    const hair = agent.palette.hair;
    const outfit = agent.palette.outfit;
    const accent = agent.palette.accent;

    const px = (c: string, x: number, y: number, w: number, h: number) => {
      ctx.fillStyle = c;
      ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
    };

    px('rgba(0,0,0,0)', 0, 0, 32, 42);

    // Shoes + legs
    px('#2b241c', 10, 34, 5, 4 + Math.max(0, walkShift));
    px('#2b241c', 18, 34, 5, 4 - Math.min(0, walkShift));
    px('#15110d', 9, 37 + Math.max(0, walkShift), 6, 2);
    px('#15110d', 17, 37 - Math.min(0, walkShift), 6, 2);

    // Body
    px(outfit, 9, 19, 14, 15);
    px(this.lighten(outfit, 22), 11, 20, 8, 3);
    px(this.darken(outfit, 0.72), 9, 31, 14, 3);

    // Arms
    if (facing === 'up') {
      px(outfit, 7, 21 - walkShift, 3, 9); px(outfit, 22, 21 + walkShift, 3, 9);
    } else if (facing === 'left') {
      px(outfit, 6, 22 - walkShift, 4, 8); px(skin, 7, 29 - walkShift, 3, 3);
    } else if (facing === 'right') {
      px(outfit, 22, 22 + walkShift, 4, 8); px(skin, 23, 29 + walkShift, 3, 3);
    } else {
      px(outfit, 6, 22 - walkShift, 3, 9); px(skin, 6, 30 - walkShift, 3, 3);
      px(outfit, 23, 22 + walkShift, 3, 9); px(skin, 23, 30 + walkShift, 3, 3);
    }

    // Head
    px(skin, 10, 10, 12, 11);
    px(this.darken(skin, 0.84), 10, 19, 12, 2);
    px(skin, 9, 14, 2, 3); px(skin, 21, 14, 2, 3);

    // Face
    if (facing === 'down') {
      if (!blink) {
        px('#ffffff', 12, 15, 3, 2); px('#ffffff', 17, 15, 3, 2);
        px('#1d1f29', 13, 15, 2, 2); px('#1d1f29', 18, 15, 2, 2);
      } else {
        px(this.darken(skin, 0.84), 12, 16, 3, 1); px(this.darken(skin, 0.84), 17, 16, 3, 1);
      }
      px(this.darken(skin, 0.84), 15, 18, 2, 1);
    } else if (facing === 'left' || facing === 'right') {
      const ex = facing === 'right' ? 18 : 11;
      if (!blink) { px('#ffffff', ex, 15, 3, 2); px('#1d1f29', ex + 1, 15, 2, 2); }
    }

    // Hair (simple top)
    if (facing !== 'up') {
      px(hair, 9, 7, 14, 5);
      px(this.lighten(hair, 28), 10, 7, 5, 1);
      px(hair, 9, 10, 2, 3); px(hair, 21, 10, 2, 3);
    } else {
      px(hair, 9, 7, 14, 10);
    }

    // Accent detail (outfit badge/logo)
    if (facing !== 'up') {
      px(accent, 7, 23 - walkShift, 4, 8);
      px(accent, 21, 23 + walkShift, 4, 8);
    }
    // Role mark
    this.drawRoleMark(ctx, agent, facing);

    // Outline
    ctx.strokeStyle = '#1a1511'; ctx.lineWidth = 2;
    ctx.strokeRect(9, 18, 14, 17);
  }

  private drawRoleMark(ctx: CanvasRenderingContext2D, agent: Agent, facing: Facing): void {
    const px = (c: string, x: number, y: number, w: number, h: number) => {
      ctx.fillStyle = c; ctx.fillRect(x, y, w, h);
    };
    const rx = facing !== 'left' ? 22 : 5;
    switch (agent.roleKey) {
      case 'pm':
        px('#f5d66e', 13, 4, 6, 3); px('#f5d66e', 14, 2, 2, 5); px('#f5d66e', 17, 2, 2, 5);
        break;
      case 'ux': px('#f9a8d4', rx, 20, 5, 7); px('#fff1f2', rx + 1, 21, 3, 3); break;
      case 'frontend': px('#67e8f9', rx, 20, 6, 5); px('#164e63', rx + 1, 21, 4, 2); break;
      case 'backend': px('#fbbf24', rx, 20, 5, 8); px('#92400e', rx + 1, 22, 3, 1); px('#92400e', rx + 1, 25, 3, 1); break;
      case 'qa': px('#86efac', rx, 20, 6, 6); px('#166534', rx + 2, 18, 2, 10); px('#166534', rx, 22, 6, 2); break;
      case 'devops': px('#c4b5fd', rx, 20, 6, 6); px('#5b21b6', rx + 1, 21, 4, 1); px('#5b21b6', rx + 1, 24, 4, 1); break;
    }
  }

  private lighten(hex: string, amt: number): string {
    const n = parseInt(hex.replace('#', ''), 16);
    const r = Math.min(255, ((n >> 16) & 255) + amt);
    const g = Math.min(255, ((n >> 8) & 255) + amt);
    const b = Math.min(255, (n & 255) + amt);
    return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
  }

  private darken(hex: string, f: number): string {
    const n = parseInt(hex.replace('#', ''), 16);
    const r = Math.round(((n >> 16) & 255) * f);
    const g = Math.round(((n >> 8) & 255) * f);
    const b = Math.round((n & 255) * f);
    return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
  }

  private createBundle(agent: Agent): AgentBundle {
    this.ensureTextures(agent);
    const { x, y } = pixelPos(agent);
    const base = `agent-ktown-${agent.id}`;

    const container = this.add.container(x, y);
    container.setDepth(y);

    const shadow = this.add.ellipse(0, 0, 28, 10, 0x000000, 0.22);
    const ring = this.add.graphics();
    const sprite = this.add.sprite(0, 0, `${base}-${agent.facing}-0`);
    sprite.setOrigin(0.5, 1);
    sprite.setInteractive({ cursor: 'pointer' });
    sprite.on('pointerdown', () => this.onSelect?.(agent.id));

    const barBg = this.add.rectangle(0, 5, 36, 4, 0x251d17, 0.88);
    barBg.setOrigin(0.5, 0.5);
    const barFill = this.add.rectangle(-17, 5, 0, 3, hexToNum(agent.accent), 1);
    barFill.setOrigin(0, 0.5);

    const name = this.add.text(0, 11, agent.name, {
      fontFamily: 'Courier New, monospace', fontSize: '10px', fontStyle: 'bold',
      color: '#fff6d6', backgroundColor: '#231c16',
      padding: { left: 4, right: 4, top: 1, bottom: 1 },
    });
    name.setOrigin(0.5, 0); name.setResolution(2);

    const role = this.add.text(0, 24, shorten(agent.role), {
      fontFamily: 'Courier New, monospace', fontSize: '8px',
      color: '#f0dca5', backgroundColor: '#231c16',
      padding: { left: 3, right: 3, top: 1, bottom: 1 },
    });
    role.setOrigin(0.5, 0); role.setResolution(2);

    container.add([shadow, ring, sprite, barBg, barFill, name, role]);

    const bundle: AgentBundle = {
      container, sprite, shadow, ring, name, role,
      barBg, barFill, bubble: null, bubbleId: null,
      currentAnim: null, lastAgent: agent,
    };
    this.bundles.set(agent.id, bundle);
    return bundle;
  }

  private updateBundle(bundle: AgentBundle, agent: Agent, selected: boolean): void {
    this.ensureTextures(agent);
    const { x, y } = pixelPos(agent);

    this.tweens.killTweensOf(bundle.container);
    if (Math.abs(bundle.container.x - x) > 2 || Math.abs(bundle.container.y - y) > 2) {
      this.tweens.add({
        targets: bundle.container, x, y,
        duration: agent.status === 'walking' ? 320 : 220, ease: 'Linear',
        onUpdate: () => bundle.container.setDepth(bundle.container.y),
      });
    } else {
      bundle.container.setPosition(x, y);
    }
    bundle.container.setDepth(y);

    bundle.name.setText(agent.name);
    bundle.role.setText(shorten(agent.role));
    bundle.barBg.setVisible(agent.status === 'working');
    bundle.barFill.setVisible(agent.status === 'working');
    if (agent.status === 'working' && agent.progress >= 0) {
      bundle.barFill.width = Math.max(3, Math.round(34 * agent.progress));
    }
    bundle.barFill.setFillStyle(hexToNum(agent.accent), 1);
    bundle.shadow.setFillStyle(0x000000, agent.status === 'walking' ? 0.16 : 0.22);

    bundle.ring.clear();
    if (selected) {
      bundle.ring.lineStyle(2, hexToNum(agent.accent), 0.96);
      bundle.ring.strokeEllipse(0, -1, 38, 14);
      bundle.ring.lineStyle(1, 0xffffff, 0.4);
      bundle.ring.strokeEllipse(0, -1, 30, 10);
    }

    // Animation
    const base = `agent-ktown-${agent.id}`;
    const animKind = agent.status === 'walking' ? 'walk' : 'idle';
    const key = `${base}-${agent.facing}-${animKind}`;
    if (bundle.currentAnim !== key) { bundle.sprite.play(key, true); bundle.currentAnim = key; }

    // Bubble
    const bubbleId = agent.bubble?.id ?? null;
    if (bundle.bubbleId !== bubbleId) {
      bundle.bubble?.destroy(); bundle.bubble = null; bundle.bubbleId = bubbleId;
      if (agent.bubble) {
        const colorMap: Record<string, number> = {
          idle: 0xffffff, work: 0xffefb3, react: 0xdbeafe, talk: 0xf2ddff, done: 0xc8f7d1,
        };
        const container = this.add.container(0, -47);
        const text = this.add.text(0, 0, agent.bubble.text, {
          fontFamily: 'Courier New, monospace', fontSize: '10px', fontStyle: 'bold',
          color: '#1e1a16', align: 'center', wordWrap: { width: 138 },
        });
        text.setOrigin(0.5, 1); text.setResolution(2);
        const w = Math.min(150, Math.max(42, text.width + 14));
        const h = Math.max(19, text.height + 9);
        const rect = this.add.rectangle(0, -text.height / 2 - 4, w, h,
          colorMap[agent.bubble.kind] ?? 0xfffbe8, 1);
        rect.setStrokeStyle(2, 0x2d261c, 0.82);
        const tail = this.add.triangle(0, 2, -6, -5, 6, -5, 0, 3,
          colorMap[agent.bubble.kind] ?? 0xfffbe8, 1);
        tail.setStrokeStyle(2, 0x2d261c, 0.82);
        container.add([rect, tail, text]);
        container.setScale(0.88);
        bundle.container.add(container);
        bundle.bubble = container;
      }
    }
    bundle.lastAgent = agent;
  }
}

/* ── React wrapper ───────────────────────────────────────────────────────── */
export function PhaserTownWorld({ agents, theme, selectedId, onSelect, onDeselect }: PhaserTownWorldProps): React.ReactElement {
  const hostRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<TownScene | null>(null);
  const gameRef = useRef<Phaser.Game | null>(null);

  useEffect(() => {
    if (!hostRef.current || gameRef.current) return undefined;
    const scene = new TownScene();
    sceneRef.current = scene;
    const game = new Phaser.Game({
      type: Phaser.AUTO,
      parent: hostRef.current,
      width: WORLD_W,
      height: WORLD_H,
      backgroundColor: '#4a9e3c',
      pixelArt: true,
      roundPixels: true,
      audio: { noAudio: true },   // no sound needed — avoids AudioContext errors on destroy
      scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
      scene,
    });
    gameRef.current = game;
    return () => {
      game.destroy(true);
      gameRef.current = null;
      sceneRef.current = null;
    };
  }, []);

  useEffect(() => {
    sceneRef.current?.sync(agents, selectedId, onSelect, onDeselect);
  }, [agents, selectedId, onSelect, onDeselect]);

  return (
    <div className={`av-phaser-world av-phaser-world--${theme.id}`}>
      <div ref={hostRef} className="av-phaser-host" />
      {!selectedId && <div className="av-world__hint">Clique sur un agent pour lui parler</div>}
    </div>
  );
}
