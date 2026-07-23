/**
 * Monster Tamers â€” Phaser scene where each agent IS an original creature.
 *
 * Original creatures (no Pokémon IP):
 *   pm       â†’ Ordrix   (Psychic fox, twin tails, floating crown)
 *   ux       â†’ Lumiole  (Fairy dragonfly, star antennae, translucent wings)
 *   frontend â†’ Zappix   (Electric gecko, orange crest, lightning tail)
 *   backend  â†’ Grotthar (Rock/Steel golem, wide arms, chest gem)
 *   qa       â†’ Debugorn (Bug/Steel mantis, built-in magnifier, radar antennae)
 *   devops   â†’ Vyntrok  (Flying/Steel raptor, propulsion jets, visor helmet)
 */
import React, { useEffect, useRef } from 'react';
import Phaser from 'phaser';
import type { Agent, AgentRoleKey, AvatarPalette, Facing, ThemeMeta } from '../types';

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

interface PhaserTamersWorldProps {
  agents: Agent[];
  theme: ThemeMeta;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onDeselect: () => void;
}

const TILE = 32;
const COLS = 16;
const ROWS = 11;
const WORLD_W = COLS * TILE;
const WORLD_H = ROWS * TILE;

interface PendingSync {
  agents: Agent[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onDeselect: () => void;
}

interface CreatureBundle {
  container: Phaser.GameObjects.Container;
  sprite: Phaser.GameObjects.Sprite;
  shadow: Phaser.GameObjects.Ellipse;
  ring: Phaser.GameObjects.Graphics;
  name: Phaser.GameObjects.Text;
  kind: Phaser.GameObjects.Text;
  barBg: Phaser.GameObjects.Rectangle;
  barFill: Phaser.GameObjects.Rectangle;
  bubble: Phaser.GameObjects.Container | null;
  bubbleId: string | null;
  currentAnim: string | null;
  lastAgent: Agent;
}

function hexToNum(c: string): number { return parseInt(c.replace('#', ''), 16); }

function px(ctx: CanvasRenderingContext2D, c: string, x: number, y: number, w: number, h: number) {
  ctx.fillStyle = c; ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
}

function strokeR(ctx: CanvasRenderingContext2D, c: string, x: number, y: number, w: number, h: number) {
  ctx.strokeStyle = c; ctx.lineWidth = 2;
  ctx.strokeRect(Math.round(x) + 1, Math.round(y) + 1, Math.round(w) - 2, Math.round(h) - 2);
}

function pixelPos(agent: Agent): { x: number; y: number } {
  return { x: (agent.pos.x + 0.5) * TILE, y: (agent.pos.y + 0.56) * TILE };
}

/* …… Creature names & kinds ………………………………………………………………………………………………………………………… */
const CREATURE: Record<AgentRoleKey, { name: string; kind: string }> = {
  pm:       { name: 'Ordrix',   kind: 'Psy' },
  ux:       { name: 'Lumiole',  kind: 'Fee' },
  frontend: { name: 'Zappix',   kind: 'Electrique' },
  backend:  { name: 'Grotthar', kind: 'Roche' },
  qa:       { name: 'Debugorn', kind: 'Insecte' },
  devops:   { name: 'Vyntrok',  kind: 'Meca' },
};

/* …… Overworld tile layout ……………………………………………………………………………………………………………………………… */
type Tile = 'grass' | 'tall-grass' | 'path' | 'water' | 'sand' | 'stone' | 'flower';

function tileAt(x: number, y: number): Tile {
  if (x <= 1 && y >= 7 && y <= 10) return 'water';
  if ((x === 2 && y >= 8) || (x <= 2 && y === 10)) return 'water';
  const isPath = x === 7 || x === 8 || y === 4 || y === 5
    || (x >= 2 && x <= 4 && y === 3)
    || (x >= 11 && x <= 13 && y === 7);
  if (isPath) return (x >= 6 && x <= 9 && y >= 3 && y <= 6) ? 'sand' : 'path';
  if (x >= 1 && x <= 4 && y >= 1 && y <= 3) return 'stone';
  if (x >= 6 && x <= 9 && y >= 1 && y <= 3) return 'stone';
  if (x >= 11 && x <= 14 && y >= 6 && y <= 8) return 'stone';
  if ((x >= 5 && x <= 9 && y >= 7 && y <= 10) || (x >= 10 && x <= 13 && y === 3)) {
    return (x + y) % 3 === 0 ? 'flower' : 'tall-grass';
  }
  return (x + y) % 3 === 0 ? 'tall-grass' : 'grass';
}

/* …… Phaser scene ……………………………………………………………………………………………………………………………………………………… */
class TamersScene extends Phaser.Scene {
  private bundles = new Map<string, CreatureBundle>();
  private pending: PendingSync | null = null;
  private isReady = false;
  private onSelect?: (id: string) => void;
  private onDeselect?: () => void;
  private dayNight?: Phaser.GameObjects.Rectangle;
  private reduced = false;

  constructor() { super({ key: 'agentverse-tamers' }); }

  create(): void {
    this.reduced = prefersReducedMotion();
    if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
      const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
      const onReducedMotionChange = (e: MediaQueryListEvent) => { this.reduced = e.matches; };
      mq.addEventListener('change', onReducedMotionChange);
      this.events.once('shutdown', () => mq.removeEventListener('change', onReducedMotionChange));
    }
    this.cameras.main.setBackgroundColor('#2d4a1e');
    this.generateTileTextures();
    this.paintTiles();
    this.paintProps();
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
        b.barFill.width = this.reduced ? 26 : 10 + ((Math.sin(time / 200) + 1) / 2) * 24;
      }
      if (b.lastAgent.status === 'talking' && !this.reduced) {
        b.sprite.y = -1 + Math.sin(time / 180) * 1.6;
      } else {
        b.sprite.y = 0;
      }
    });

    if (this.dayNight && !this.reduced) {
      const period = 150000;
      const phase = (time % period) / period;
      const night = (1 - Math.cos(phase * Math.PI * 2)) / 2;
      const r = Math.round(255 - night * 80);
      const g = Math.round(255 - night * 64);
      const b = Math.round(255 - night * 16);
      this.dayNight.setFillStyle((r << 16) | (g << 8) | b, 1);
    }
  }

  private applyGbaGrade(): void {
    const cam = this.cameras.main;
    if (!cam.filters) return;
    try {
      const cm = cam.filters.internal.addColorMatrix();
      cm.colorMatrix.saturate(0.22, true).contrast(0.10, true);
      cam.filters.internal.addVignette(0.5, 0.5, 0.62, 0.42);
      cam.filters.internal.addBarrel(1.03);
    } catch {
      /* WebGL filters unavailable — world still renders, just ungraded */
    }
  }

  private buildDayNight(): Phaser.GameObjects.Rectangle {
    const r = this.add.rectangle(WORLD_W / 2, WORLD_H / 2, WORLD_W, WORLD_H, 0xffffff, 1);
    r.setScrollFactor(0);
    r.setDepth(50000);
    r.setBlendMode(Phaser.BlendModes.MULTIPLY);
    return r;
  }

  sync(agents: Agent[], selectedId: string | null, onSelect: (id: string) => void, onDeselect: () => void): void {
    this.onSelect = onSelect; this.onDeselect = onDeselect;
    if (!this.isReady) { this.pending = { agents, selectedId, onSelect, onDeselect }; return; }
    const ids = new Set(agents.map((a) => a.id));
    this.bundles.forEach((b, id) => { if (!ids.has(id)) { b.container.destroy(); this.bundles.delete(id); } });
    agents.forEach((a) => {
      const b = this.bundles.get(a.id) ?? this.createBundle(a);
      this.updateBundle(b, a, selectedId === a.id);
    });
  }

  /* …… Tile textures ……………………………………………………………………………………………………………………………………………… */
  private generateTileTextures(): void {
    this.addTex('tile-grass', TILE, TILE, (ctx) => {
      px(ctx, '#4a9e3c', 0, 0, TILE, TILE);
      px(ctx, '#5cb64c', 4, 7, 3, 2); px(ctx, '#3a8230', 18, 14, 2, 3); px(ctx, '#62c254', 24, 25, 2, 2);
    });
    this.addTex('tile-tall-grass', TILE, TILE, (ctx) => {
      px(ctx, '#3d8c2f', 0, 0, TILE, TILE);
      for (let i = 0; i < 10; i++) {
        const gx = 2 + i * 3; const gh = 10 + (i % 3) * 4;
        px(ctx, i % 2 ? '#4ea83e' : '#56be48', gx, TILE - gh, 2, gh);
      }
    });
    this.addTex('tile-path', TILE, TILE, (ctx) => {
      px(ctx, '#c8a45a', 0, 0, TILE, TILE);
      px(ctx, '#d9b86a', 0, 0, TILE, 3); px(ctx, '#a8843e', 0, 29, TILE, 3);
      px(ctx, '#c09048', 6, 11, 5, 3); px(ctx, '#d6b262', 21, 19, 6, 3);
    });
    this.addTex('tile-sand', TILE, TILE, (ctx) => {
      px(ctx, '#e8c87a', 0, 0, TILE, TILE);
      strokeR(ctx, '#d4a85a', 0, 0, TILE, TILE);
      px(ctx, '#f2d890', 5, 8, 7, 3); px(ctx, '#c8a05a', 19, 21, 8, 3);
    });
    this.addTex('tile-stone', TILE, TILE, (ctx) => {
      px(ctx, '#8a9486', 0, 0, TILE, TILE);
      strokeR(ctx, '#6a7466', 0, 0, TILE, TILE);
      px(ctx, '#a8b2a4', 4, 5, 8, 3); px(ctx, '#728070', 18, 20, 8, 3);
    });
    [0, 1, 2].forEach((f) => {
      this.addTex(`tile-water-${f}`, TILE, TILE, (ctx) => {
        px(ctx, '#3890d0', 0, 0, TILE, TILE);
        px(ctx, '#1e6aaa', 0, 26, TILE, 6);
        px(ctx, '#68c8ee', 3 + f * 4, 7, 12, 2); px(ctx, '#aae4f8', 19 - f * 2, 17, 8, 2);
      });
    });
    [0, 1].forEach((f) => {
      this.addTex(`tile-flower-${f}`, TILE, TILE, (ctx) => {
        px(ctx, '#4a9e3c', 0, 0, TILE, TILE);
        const sw = f ? 1 : 0;
        this.drawFlower(ctx, 5 + sw, 7, '#f472b6'); this.drawFlower(ctx, 17 - sw, 14, '#facc15');
        this.drawFlower(ctx, 12, 22 - sw, '#f97316');
      });
    });
    this.createAnim('water-anim', ['tile-water-0', 'tile-water-1', 'tile-water-2', 'tile-water-1'], 5);
    this.createAnim('flower-anim', ['tile-flower-0', 'tile-flower-1'], 2);
  }

  private paintTiles(): void {
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        const t = tileAt(x, y);
        const key = t === 'water' ? 'tile-water-0' : t === 'flower' ? 'tile-flower-0' : `tile-${t}`;
        const s = this.add.sprite(x * TILE + 16, y * TILE + 16, key);
        s.setDepth(y * 0.01);
        if (t === 'water' && !this.reduced) s.play('water-anim');
        if (t === 'flower' && !this.reduced) s.play('flower-anim');
      }
    }
  }

  private paintProps(): void {
    // Trees scattered around the map
    const trees: [number, number][] = [
      [0.5, 0.8], [1.2, 9.6], [4.4, 0.9], [5.6, 9.9],
      [10.1, 0.8], [13.8, 0.9], [14.7, 3.2], [14.8, 9.3], [15.2, 6.2],
    ];
    trees.forEach(([x, y]) => this.addProp('prop-tree', x, y));

    // Rocks
    const rocks: [number, number][] = [
      [3.6, 6.2], [5.3, 8.6], [8.1, 8.4], [10.9, 8.7], [13.9, 5.9],
    ];
    rocks.forEach(([x, y]) => this.addProp('prop-rock', x, y));

    // Building-like structures for each zone
    this.addProp('prop-house', 2.2, 2.2);
    this.addProp('prop-shrine', 12.2, 2.1);
    this.addProp('prop-tent', 12.5, 8.1);

    // Creature dens (spawn points)
    this.addProp('prop-den', 6.8, 8.3);
    this.addProp('prop-den', 9.8, 2.9);

    // Sign post
    this.addProp('prop-sign', 4.8, 4.3);

    // Lamps animated
    ([[5.9, 4.6], [7.4, 6.3], [10.9, 2.9], [13.8, 5.9]] as [number, number][])
      .forEach(([x, y]) => this.addProp('prop-lamp', x, y, this.reduced ? undefined : 'lamp-anim'));

    // Stations per agent
    ([[3.2, 3.9], [7.2, 3.9], [12.2, 3.9], [3.2, 7.9], [7.2, 7.9], [12.2, 7.9]] as [number, number][])
      .forEach(([x, y]) => this.addProp('prop-station', x, y));

    // Sparkles
    if (!this.reduced) {
      ([[4.9, 2.8], [10.3, 3.4], [13.0, 5.5], [7.9, 8.1]] as [number, number][])
        .forEach(([x, y], i) => {
          const s = this.add.sprite(x * TILE, y * TILE, 'prop-sparkle-0').play('sparkle-anim');
          s.setDepth(90 + i); s.setAlpha(0.72);
        });
    }

    this.generatePropTextures();
  }

  private generatePropTextures(): void {
    this.addTex('prop-tree', 46, 58, (ctx) => {
      px(ctx, '#5b3b26', 19, 31, 8, 20); px(ctx, '#7a5430', 22, 31, 3, 20);
      px(ctx, '#276f3a', 7, 18, 32, 20); px(ctx, '#2f8a45', 3, 11, 30, 21);
      px(ctx, '#3aa653', 13, 5, 27, 20); px(ctx, '#91d477', 20, 8, 8, 4);
      px(ctx, '#1f5e31', 7, 32, 32, 5);
    });
    this.addTex('prop-rock', 28, 22, (ctx) => {
      px(ctx, '#7a8880', 3, 8, 20, 10); px(ctx, '#9eaaa4', 7, 4, 14, 7);
      px(ctx, '#5a6662', 5, 17, 18, 3);
    });
    this.addTex('prop-house', 68, 60, (ctx) => {
      px(ctx, '#7a4a2a', 6, 23, 54, 28); px(ctx, '#f0cc88', 10, 27, 46, 22);
      px(ctx, '#a44035', 4, 16, 58, 12); px(ctx, '#c55848', 12, 9, 42, 12);
      px(ctx, '#742c2e', 18, 5, 30, 8); px(ctx, '#5b3820', 29, 34, 10, 17);
      px(ctx, '#6fbfe8', 14, 31, 10, 8); px(ctx, '#6fbfe8', 43, 31, 10, 8);
      strokeR(ctx, '#5b3b26', 6, 22, 54, 30);
    });
    this.addTex('prop-shrine', 56, 62, (ctx) => {
      px(ctx, '#c8b87a', 4, 48, 48, 10); px(ctx, '#ddd0a0', 8, 32, 40, 18);
      px(ctx, '#8a7248', 4, 26, 48, 8); px(ctx, '#a0885a', 10, 12, 36, 16);
      px(ctx, '#ccc0a0', 18, 8, 20, 8); px(ctx, '#c86820', 24, 4, 8, 8);
      px(ctx, '#e8a030', 27, 5, 2, 6); px(ctx, '#c86820', 20, 30, 16, 4);
      strokeR(ctx, '#6b5030', 8, 32, 40, 26);
    });
    this.addTex('prop-tent', 54, 48, (ctx) => {
      px(ctx, '#c84040', 4, 22, 46, 20); px(ctx, '#e85050', 4, 22, 46, 4);
      px(ctx, '#9a2828', 2, 40, 50, 6); px(ctx, '#8a2020', 22, 32, 10, 15);
      for (let i = 0; i < 4; i++) { px(ctx, '#f0b020', 5 + i * 12, 22, 3, 6); }
      const rx = (n: number) => 27 - n; const ry = (n: number) => 22 - n;
      for (let n = 0; n < 22; n++) { px(ctx, '#c84040', rx(n), ry(n), 1, 1); px(ctx, '#c84040', 27 + n, ry(n), 1, 1); }
    });
    this.addTex('prop-den', 44, 36, (ctx) => {
      px(ctx, '#8a6040', 3, 10, 38, 22); px(ctx, '#a07858', 3, 10, 38, 6);
      px(ctx, '#1e1408', 16, 14, 12, 16); px(ctx, '#34220e', 12, 18, 20, 10);
      px(ctx, '#c09070', 5, 9, 8, 4); px(ctx, '#c09070', 31, 9, 8, 4);
    });
    this.addTex('prop-sign', 24, 32, (ctx) => {
      px(ctx, '#7a5230', 10, 12, 4, 18); px(ctx, '#f0c870', 3, 5, 18, 13);
      strokeR(ctx, '#6b4428', 3, 5, 18, 13);
    });
    this.addTex('prop-station', 40, 30, (ctx) => {
      px(ctx, '#4e5830', 4, 15, 32, 9); px(ctx, '#7a8848', 3, 9, 34, 8);
      px(ctx, '#203848', 12, 2, 16, 12); px(ctx, '#60c8a8', 15, 5, 10, 5);
      px(ctx, '#2a1e10', 5, 24, 6, 5); px(ctx, '#2a1e10', 29, 24, 6, 5);
    });
    [0, 1, 2].forEach((f) => {
      this.addTex(`prop-lamp-${f}`, 18, 34, (ctx) => {
        px(ctx, '#5b3922', 8, 14, 3, 18); px(ctx, '#3f281b', 5, 30, 9, 3);
        px(ctx, f === 1 ? '#ffe890' : '#ffc830', 5, 6, 9, 9);
        px(ctx, '#fff5d0', 8, 8, 3, 3); px(ctx, '#8b5d34', 4, 5, 11, 2);
      });
    });
    [0, 1, 2].forEach((f) => {
      this.addTex(`prop-sparkle-${f}`, 8, 8, (ctx) => {
        if (f === 0) px(ctx, '#ffffff', 3, 3, 2, 2);
        if (f === 1) { px(ctx, '#ffffff', 3, 1, 2, 6); px(ctx, '#ffffff', 1, 3, 6, 2); }
        if (f === 2) { px(ctx, '#e5f7ff', 2, 0, 4, 8); px(ctx, '#e5f7ff', 0, 2, 8, 4); }
      });
    });
    this.createAnim('lamp-anim', ['prop-lamp-0', 'prop-lamp-1', 'prop-lamp-2', 'prop-lamp-1'], 6);
    this.createAnim('sparkle-anim', ['prop-sparkle-0', 'prop-sparkle-1', 'prop-sparkle-2', 'prop-sparkle-1'], 7);
  }

  private paintZoneLabels(): void {
    [
      ['Plaine Verte', 2.6, 0.65], ['Grotte IA', 2.4, 3.6],
      ['Plateau Nord', 12.2, 0.65], ['Forge', 2.6, 6.1],
      ['Prairie QA', 7.3, 6.1], ['Terminus', 12.5, 6.1],
    ].forEach(([text, x, y]) => {
      const lbl = this.add.text((x as number) * TILE, (y as number) * TILE, text as string, {
        fontFamily: 'Courier New, monospace', fontSize: '9px',
        color: '#fffbe0', backgroundColor: '#1e2c14',
        padding: { left: 4, right: 4, top: 2, bottom: 2 },
      });
      lbl.setOrigin(0.5, 0.5); lbl.setDepth(12); lbl.setResolution(2);
    });
  }

  /* …… Creature sprites …………………………………………………………………………………………………………………………………… */
  private ensureCreatureTextures(agent: Agent): void {
    const base = `creature-${agent.id}`;
    (['down', 'up', 'left', 'right'] as Facing[]).forEach((facing) => {
      [0, 1, 2, 3].forEach((frame) => {
        const key = `${base}-${facing}-${frame}`;
        this.addTex(key, 32, 36, (ctx) => this.drawCreature(ctx, agent, facing, frame));
      });
      const idle = `${base}-${facing}-idle`;
      const walk = `${base}-${facing}-walk`;
      if (!this.anims.exists(idle)) {
        this.anims.create({ key: idle,
          frames: [{ key: `${base}-${facing}-0`, duration: 1100 }, { key: `${base}-${facing}-3`, duration: 130 }],
          frameRate: 2, repeat: -1 });
      }
      if (!this.anims.exists(walk)) {
        this.anims.create({ key: walk,
          frames: [
            { key: `${base}-${facing}-0` }, { key: `${base}-${facing}-1` },
            { key: `${base}-${facing}-0` }, { key: `${base}-${facing}-2` },
          ],
          frameRate: 9, repeat: -1 });
      }
    });
  }

  /**
   * Draw an original creature sprite on the canvas.
   * Canvas is 32Ã—36. frame 0=neutral, 1=walk-R, 2=walk-L, 3=blink.
   */
  private drawCreature(ctx: CanvasRenderingContext2D, agent: Agent, facing: Facing, frame: number): void {
    const walkX = frame === 1 ? 2 : frame === 2 ? -2 : 0;
    const blink = frame === 3;
    const p = agent.palette;

    px(ctx, 'rgba(0,0,0,0)', 0, 0, 32, 36);

    switch (agent.roleKey as AgentRoleKey) {
      case 'pm': this.drawOrdrix(ctx, p, facing, walkX, blink); break;
      case 'ux': this.drawLumiole(ctx, p, facing, walkX, blink); break;
      case 'frontend': this.drawZappix(ctx, p, facing, walkX, blink); break;
      case 'backend': this.drawGrotthar(ctx, p, facing, walkX, blink); break;
      case 'qa': this.drawDebugorn(ctx, p, facing, walkX, blink); break;
      case 'devops': this.drawVyntrok(ctx, p, facing, walkX, blink); break;
      default: this.drawOrdrix(ctx, p, facing, walkX, blink);
    }
  }

  /* ………………………………………………………………………………………………………………………………………………………………………………
     Ordrix â€” Psychic fox, twin tails, floating crown (PM)
     Body colour: indigo/violet. Crown: gold.
  ……………………………………………………………………………………………………………………………………………………………………………… */
  private drawOrdrix(ctx: CanvasRenderingContext2D, p: AvatarPalette,
    facing: Facing, wx: number, blink: boolean): void {
    const fur = p.outfit;    // indigo
    const dark = '#3a2a7a';
    const light = '#a090ff';
    const eye = blink ? fur : '#dce8ff';
    const pupil = '#1a0a3a';

    // tails (behind body)
    if (facing !== 'up') {
      px(ctx, fur, 5, 22, 4, 10); px(ctx, dark, 5, 30, 4, 3);
      px(ctx, fur, 23, 22, 4, 10); px(ctx, dark, 23, 30, 4, 3);
      px(ctx, light, 6, 23, 2, 3); px(ctx, light, 24, 23, 2, 3);
    } else {
      px(ctx, fur, 4, 26, 5, 8); px(ctx, fur, 23, 26, 5, 8);
    }

    // body
    px(ctx, fur, 10, 18, 12, 14);
    px(ctx, light, 13, 19, 6, 3);
    px(ctx, dark, 10, 30, 12, 2);

    // legs
    px(ctx, fur, 11, 30 + wx, 4, 5); px(ctx, fur, 17, 30 - wx, 4, 5);
    px(ctx, dark, 11, 34 + Math.max(0, wx), 4, 2);
    px(ctx, dark, 17, 34 - Math.min(0, wx), 4, 2);

    // head
    px(ctx, fur, 10, 8, 12, 12);
    px(ctx, light, 12, 9, 8, 3);

    // ears
    if (facing !== 'up') {
      px(ctx, fur, 9, 3, 4, 7); px(ctx, '#ff8fc0', 10, 4, 2, 4);
      px(ctx, fur, 19, 3, 4, 7); px(ctx, '#ff8fc0', 20, 4, 2, 4);
    } else {
      px(ctx, fur, 8, 2, 5, 8); px(ctx, fur, 19, 2, 5, 8);
    }

    // face (front / side only)
    if (facing === 'down') {
      px(ctx, eye, 12, 13, 3, blink ? 1 : 2); px(ctx, eye, 17, 13, 3, blink ? 1 : 2);
      if (!blink) { px(ctx, pupil, 13, 13, 2, 2); px(ctx, pupil, 18, 13, 2, 2); }
      px(ctx, '#c070b0', 15, 17, 2, 1); // nose-mouth
    } else if (facing === 'left' || facing === 'right') {
      const ex = facing === 'right' ? 18 : 11;
      px(ctx, eye, ex, 13, 3, blink ? 1 : 2);
      if (!blink) px(ctx, pupil, ex + 1, 13, 2, 2);
    }

    // floating crown (PM signature)
    if (facing !== 'up') {
      px(ctx, '#f5d66e', 12, 1, 8, 3);
      px(ctx, '#f5d66e', 11, 0, 2, 4); px(ctx, '#f5d66e', 15, 0, 2, 4); px(ctx, '#f5d66e', 19, 0, 2, 4);
      px(ctx, '#ff6090', 12, 1, 2, 2); px(ctx, '#60d0ff', 16, 1, 2, 2); px(ctx, '#a0ff80', 20, 1, 2, 2);
    }
  }

  /* ………………………………………………………………………………………………………………………………………………………………………………
     Lumiole â€” Fairy dragonfly, star antennae, wings (UX)
     Body colour: pink/rose. Wings: translucent cyan.
  ……………………………………………………………………………………………………………………………………………………………………………… */
  private drawLumiole(ctx: CanvasRenderingContext2D, p: AvatarPalette,
    facing: Facing, wx: number, blink: boolean): void {
    const body = p.outfit;   // pink
    const dark = '#8a1a50';
    const light = '#ffb0e0';
    const wing = 'rgba(100,230,240,0.55)';
    const wingDark = 'rgba(40,180,200,0.65)';
    const eye = blink ? body : '#ffffff';
    const pupil = '#1a0a2a';

    // wings (behind body)
    if (facing === 'down' || facing === 'up') {
      px(ctx, wing, 2, 10, 8, 10); px(ctx, wing, 22, 10, 8, 10);
      px(ctx, wingDark, 2, 10, 1, 10); px(ctx, wingDark, 29, 10, 1, 10);
    } else {
      const wx2 = facing === 'right' ? 20 : 4;
      px(ctx, wing, wx2, 8, 8, 12);
    }

    // body + abdomen
    px(ctx, body, 11, 16, 10, 14);
    px(ctx, light, 13, 17, 6, 3);
    px(ctx, dark, 12, 28, 8, 2);
    // abdomen segments
    [0, 1, 2].forEach((i) => px(ctx, i % 2 ? dark : light, 13, 22 + i * 3, 6, 2));

    // legs (delicate)
    px(ctx, dark, 11, 28 + wx, 2, 5); px(ctx, dark, 19, 28 - wx, 2, 5);

    // head
    px(ctx, body, 11, 8, 10, 10);
    px(ctx, light, 13, 9, 6, 3);

    // antennae with stars
    if (facing !== 'up') {
      px(ctx, '#2a1a3a', 12, 2, 1, 7); px(ctx, '#2a1a3a', 19, 2, 1, 7);
      px(ctx, '#facc15', 10, 0, 4, 4); px(ctx, '#facc15', 18, 0, 4, 4);
      px(ctx, '#ffffff', 11, 1, 2, 2); px(ctx, '#ffffff', 19, 1, 2, 2);
    }

    // eyes
    if (facing === 'down') {
      px(ctx, eye, 12, 13, 3, blink ? 1 : 2); px(ctx, eye, 17, 13, 3, blink ? 1 : 2);
      if (!blink) { px(ctx, pupil, 13, 13, 2, 2); px(ctx, pupil, 18, 13, 2, 2); }
      px(ctx, '#ff80c0', 14, 16, 4, 1);
    } else if (facing === 'left' || facing === 'right') {
      const ex = facing === 'right' ? 18 : 11;
      px(ctx, eye, ex, 12, 3, blink ? 1 : 2);
      if (!blink) px(ctx, pupil, ex + 1, 12, 2, 2);
    }
  }

  /* ………………………………………………………………………………………………………………………………………………………………………………
     Zappix â€” Electric gecko, orange crest, lightning tail (Frontend)
     Body colour: cyan/teal. Crest: orange.
  ……………………………………………………………………………………………………………………………………………………………………………… */
  private drawZappix(ctx: CanvasRenderingContext2D, p: AvatarPalette,
    facing: Facing, wx: number, blink: boolean): void {
    const body = p.outfit;   // cyan
    const dark = '#0a6070';
    const scale = '#40d0f0';
    const crest = '#f97316';
    const eye = blink ? body : '#ffffff';
    const pupil = '#0a1a2a';

    // tail (lightning zigzag)
    if (facing === 'down' || facing === 'up') {
      px(ctx, '#facc15', 14, 28, 4, 4); px(ctx, '#facc15', 17, 32, 4, 3);
      px(ctx, '#f97316', 15, 29, 2, 3); px(ctx, '#f97316', 18, 33, 2, 2);
    } else {
      const tx = facing === 'right' ? 3 : 25;
      for (let i = 0; i < 5; i++) {
        px(ctx, i % 2 ? '#facc15' : '#f97316', tx + (facing === 'right' ? -i : i) * 2, 20 + i * 2, 3, 2);
      }
    }

    // body (lizard shape: wide shoulders, narrowing)
    px(ctx, body, 10, 16, 12, 12);
    px(ctx, scale, 13, 17, 6, 3);
    px(ctx, dark, 10, 26, 12, 2);
    // scale pattern
    [0, 1, 2].forEach((i) => px(ctx, i % 2 ? dark : scale, 11 + i * 4, 20, 3, 3));

    // legs
    px(ctx, body, 10, 26 + wx, 4, 6); px(ctx, body, 18, 26 - wx, 4, 6);
    px(ctx, dark, 10, 31 + Math.max(0, wx), 4, 2);
    px(ctx, dark, 18, 31 - Math.min(0, wx), 4, 2);

    // neck + head (wider, gecko-shaped)
    px(ctx, body, 12, 6, 8, 12);
    px(ctx, scale, 14, 7, 4, 4);

    // crest (signature orange)
    if (facing !== 'up') {
      px(ctx, crest, 10, 2, 2, 8); px(ctx, crest, 13, 1, 2, 9);
      px(ctx, crest, 16, 2, 2, 8); px(ctx, crest, 19, 3, 2, 6);
      px(ctx, '#ff4500', 11, 2, 1, 6); px(ctx, '#ff4500', 14, 1, 1, 7);
    }

    // eyes
    if (facing === 'down') {
      px(ctx, eye, 13, 11, 3, blink ? 1 : 2); px(ctx, eye, 16, 11, 3, blink ? 1 : 2);
      if (!blink) { px(ctx, pupil, 14, 11, 2, 2); px(ctx, pupil, 17, 11, 2, 2); }
    } else if (facing === 'left' || facing === 'right') {
      const ex = facing === 'right' ? 17 : 12;
      px(ctx, eye, ex, 10, 3, blink ? 1 : 2);
      if (!blink) px(ctx, pupil, ex + 1, 10, 2, 2);
    }
  }

  /* ………………………………………………………………………………………………………………………………………………………………………………
     Grotthar â€” Rock/Steel golem, wide arms, chest gem (Backend)
     Body colour: amber/gold. Gem: cyan.
  ……………………………………………………………………………………………………………………………………………………………………………… */
  private drawGrotthar(ctx: CanvasRenderingContext2D, p: AvatarPalette,
    facing: Facing, wx: number, blink: boolean): void {
    const rock = p.outfit;   // amber/gold
    const dark = '#6a4010';
    const crack = '#382008';
    const gem = '#00e8ff';
    const eye = blink ? rock : '#ffefb0';

    // wide arms (golem-style)
    if (facing === 'down' || facing === 'up') {
      px(ctx, rock, 3, 18, 7, 10); px(ctx, dark, 3, 26, 7, 2);
      px(ctx, rock, 22, 18, 7, 10); px(ctx, dark, 22, 26, 7, 2);
      px(ctx, crack, 5, 22, 2, 4); px(ctx, crack, 25, 22, 2, 4);
    } else {
      const ax = facing === 'right' ? 22 : 3;
      px(ctx, rock, ax, 18, 7, 10); px(ctx, crack, ax + 2, 22, 2, 4);
    }

    // body (chunky)
    px(ctx, rock, 9, 15, 14, 16);
    px(ctx, '#f0c040', 11, 16, 10, 4); // lighter top
    px(ctx, dark, 9, 29, 14, 2);
    px(ctx, crack, 11, 22, 3, 5); px(ctx, crack, 18, 20, 2, 6); // crack lines

    // legs (stumpy)
    px(ctx, rock, 11, 30 + wx, 4, 5); px(ctx, rock, 17, 30 - wx, 4, 5);
    px(ctx, dark, 10, 34 + Math.max(0, wx), 5, 2);
    px(ctx, dark, 16, 34 - Math.min(0, wx), 5, 2);

    // chest gem
    if (facing !== 'up') {
      px(ctx, gem, 14, 20, 4, 5);
      px(ctx, '#ffffff', 14, 20, 2, 1);
      px(ctx, '#0080c0', 14, 24, 4, 1);
    }

    // head (square, rocky)
    px(ctx, rock, 10, 5, 12, 12);
    px(ctx, '#f0c040', 12, 6, 8, 4);
    px(ctx, crack, 12, 12, 3, 3); px(ctx, crack, 17, 10, 2, 4);

    // brow ridges
    px(ctx, dark, 10, 9, 4, 2); px(ctx, dark, 18, 9, 4, 2);

    if (facing === 'down') {
      px(ctx, eye, 12, 11, 3, blink ? 1 : 3); px(ctx, eye, 17, 11, 3, blink ? 1 : 3);
      px(ctx, '#ff8020', 14, 15, 4, 1); // mouth glow
    } else if (facing === 'left' || facing === 'right') {
      const ex = facing === 'right' ? 17 : 10;
      px(ctx, eye, ex, 11, 3, blink ? 1 : 3);
    }
  }

  /* ………………………………………………………………………………………………………………………………………………………………………………
     Debugorn â€” Bug/Steel mantis, magnifier eye, radar antennae (QA)
     Body colour: green. Magnifier: white/glass.
  ……………………………………………………………………………………………………………………………………………………………………………… */
  private drawDebugorn(ctx: CanvasRenderingContext2D, p: AvatarPalette,
    facing: Facing, wx: number, blink: boolean): void {
    const carap = p.outfit;  // green
    const dark = '#0a5020';
    const metal = '#a8c0a0';
    const glass = '#c8f0ff';

    // scythe arms
    if (facing === 'down' || facing === 'up') {
      px(ctx, metal, 4, 14, 5, 12); px(ctx, carap, 4, 14, 2, 8);
      px(ctx, metal, 23, 14, 5, 12); px(ctx, carap, 25, 14, 2, 8);
      // blade tips
      px(ctx, '#e0e8e0', 3, 12, 2, 4); px(ctx, '#e0e8e0', 27, 12, 2, 4);
    } else {
      const ax = facing === 'right' ? 21 : 6;
      px(ctx, metal, ax, 14, 5, 12); px(ctx, '#e0e8e0', facing === 'right' ? 25 : 6, 12, 2, 4);
    }

    // body (segmented)
    px(ctx, carap, 10, 16, 12, 14);
    px(ctx, '#30c060', 12, 17, 8, 3);
    [0, 1, 2].forEach((i) => {
      px(ctx, i % 2 ? dark : '#20a040', 11, 21 + i * 3, 10, 2);
    });

    // legs (3 pairs)
    px(ctx, dark, 10, 24 + wx, 2, 8); px(ctx, dark, 20, 24 - wx, 2, 8);
    px(ctx, dark, 9, 27, 2, 6); px(ctx, dark, 21, 27, 2, 6);

    // thorax + head
    px(ctx, carap, 11, 8, 10, 10);
    px(ctx, '#30c060', 13, 9, 6, 4);

    // compound eye (magnifier signature)
    if (facing !== 'up') {
      px(ctx, '#1a1a1a', 8, 4, 10, 10); // frame
      px(ctx, glass, 9, 5, 8, 8);
      px(ctx, '#0040a0', 11, 7, 4, 4); // lens
      px(ctx, '#ffffff', 11, 7, 2, 2);  // reflection
      px(ctx, '#1a1a1a', 8, 13, 3, 4); // handle
      // radar antenna
      px(ctx, '#1a1a1a', 21, 3, 2, 8);
      px(ctx, '#ff3040', 20, 1, 4, 4); // blip
      px(ctx, '#ffffff', 21, 2, 2, 1);
    } else {
      px(ctx, carap, 11, 6, 10, 8);
      px(ctx, '#1a1a1a', 14, 2, 2, 6); px(ctx, '#1a1a1a', 17, 2, 2, 6);
      px(ctx, '#ff3040', 13, 0, 4, 3); px(ctx, '#ff3040', 16, 0, 4, 3);
    }

    if (facing === 'down' && !blink) {
      px(ctx, '#00ff80', 13, 10, 2, 2); px(ctx, '#00ff80', 17, 10, 2, 2); // multi-eye
    }
  }

  /* ………………………………………………………………………………………………………………………………………………………………………………
     Vyntrok â€” Flying/Steel raptor, jets, visor helmet (DevOps)
     Body colour: violet. Visor: orange glow.
  ……………………………………………………………………………………………………………………………………………………………………………… */
  private drawVyntrok(ctx: CanvasRenderingContext2D, p: AvatarPalette,
    facing: Facing, wx: number, blink: boolean): void {
    const body = p.outfit;  // violet/purple
    const dark = '#3a1a70';
    const metal = '#8880b8';
    const jet = '#ff8020';
    const visor = '#ff9030';

    // jet exhaust
    if (facing !== 'up') {
      [1, 2].forEach((i) => {
        px(ctx, jet, 8 + i * 7, 30, 4, i * 2 + 2);
        px(ctx, '#ffdf60', 9 + i * 7, 31, 2, i);
      });
    }

    // wings
    if (facing === 'down' || facing === 'up') {
      px(ctx, metal, 2, 14, 8, 6); px(ctx, dark, 2, 18, 8, 2);
      px(ctx, metal, 22, 14, 8, 6); px(ctx, dark, 22, 18, 8, 2);
      px(ctx, '#c0b8f0', 3, 14, 6, 2); px(ctx, '#c0b8f0', 23, 14, 6, 2);
    } else {
      const wx2 = facing === 'right' ? 4 : 20;
      px(ctx, metal, wx2, 12, 8, 8); px(ctx, '#c0b8f0', wx2 + 1, 12, 6, 2);
    }

    // body (sleek raptor)
    px(ctx, body, 10, 16, 12, 14);
    px(ctx, metal, 13, 17, 6, 3);
    px(ctx, dark, 10, 28, 12, 2);
    // jet pack modules
    px(ctx, metal, 9, 18, 3, 8); px(ctx, metal, 20, 18, 3, 8);
    px(ctx, jet, 9, 24, 3, 4); px(ctx, jet, 20, 24, 3, 4);

    // legs
    px(ctx, body, 11, 28 + wx, 4, 6); px(ctx, body, 17, 28 - wx, 4, 6);
    px(ctx, dark, 11, 33 + Math.max(0, wx), 4, 2);
    px(ctx, dark, 17, 33 - Math.min(0, wx), 4, 2);
    // talons
    px(ctx, metal, 10, 34 + Math.max(0, wx), 6, 2);
    px(ctx, metal, 16, 34 - Math.min(0, wx), 6, 2);

    // head + helmet
    px(ctx, body, 10, 6, 12, 12);
    px(ctx, dark, 10, 6, 12, 3); // helmet top
    px(ctx, metal, 9, 9, 14, 4); // helmet brim

    // visor (signature orange glow)
    if (facing !== 'up') {
      px(ctx, '#1a1228', 10, 10, 12, 5);
      px(ctx, visor, 11, 11, 10, 3);
      px(ctx, '#ffe090', 12, 11, 6, 1); // shine
      px(ctx, jet, 10, 13, 12, 1);
    }

    if (facing === 'down' && !blink) {
      px(ctx, '#ff6010', 14, 12, 4, 1); // HUD line in visor
    }

    // tail feathers
    if (facing !== 'up') {
      px(ctx, metal, 13, 29, 6, 3);
      px(ctx, '#c0b8f0', 12, 28, 2, 2); px(ctx, '#c0b8f0', 18, 28, 2, 2);
    }
  }

  /* …… Bundle creation / update ………………………………………………………………………………………………………………… */
  private createBundle(agent: Agent): CreatureBundle {
    this.ensureCreatureTextures(agent);
    const { x, y } = pixelPos(agent);
    const base = `creature-${agent.id}`;
    const container = this.add.container(x, y);
    container.setDepth(y);

    const shadow = this.add.ellipse(0, 2, 28, 10, 0x000000, 0.2);
    const ring = this.add.graphics();
    const sprite = this.add.sprite(0, 0, `${base}-${agent.facing}-0`);
    sprite.setOrigin(0.5, 1);
    sprite.setInteractive({ cursor: 'pointer' });
    sprite.on('pointerdown', () => this.onSelect?.(agent.id));

    const barBg = this.add.rectangle(0, 6, 38, 4, 0x1a1208, 0.9);
    barBg.setOrigin(0.5, 0.5);
    const barFill = this.add.rectangle(-18, 6, 0, 3, hexToNum(agent.accent), 1);
    barFill.setOrigin(0, 0.5);

    const cr = CREATURE[agent.roleKey as AgentRoleKey] || { name: agent.name, kind: '' };

    const name = this.add.text(0, 12, cr.name, {
      fontFamily: 'Courier New, monospace', fontSize: '10px', fontStyle: 'bold',
      color: '#fff8d0', backgroundColor: '#1a1208',
      padding: { left: 4, right: 4, top: 1, bottom: 1 },
    });
    name.setOrigin(0.5, 0); name.setResolution(2);

    const kind = this.add.text(0, 25, cr.kind, {
      fontFamily: 'Courier New, monospace', fontSize: '8px',
      color: '#f0c860', backgroundColor: '#1a1208',
      padding: { left: 3, right: 3, top: 1, bottom: 1 },
    });
    kind.setOrigin(0.5, 0); kind.setResolution(2);

    container.add([shadow, ring, sprite, barBg, barFill, name, kind]);

    const bundle: CreatureBundle = {
      container, sprite, shadow, ring, name, kind,
      barBg, barFill, bubble: null, bubbleId: null,
      currentAnim: null, lastAgent: agent,
    };
    this.bundles.set(agent.id, bundle);
    return bundle;
  }

  private updateBundle(bundle: CreatureBundle, agent: Agent, selected: boolean): void {
    this.ensureCreatureTextures(agent);
    const { x, y } = pixelPos(agent);

    this.tweens.killTweensOf(bundle.container);
    if (Math.abs(bundle.container.x - x) > 2 || Math.abs(bundle.container.y - y) > 2) {
      this.tweens.add({ targets: bundle.container, x, y,
        duration: agent.status === 'walking' ? 300 : 200, ease: 'Linear',
        onUpdate: () => bundle.container.setDepth(bundle.container.y) });
    } else {
      bundle.container.setPosition(x, y);
    }
    bundle.container.setDepth(y);

    bundle.barBg.setVisible(agent.status === 'working');
    bundle.barFill.setVisible(agent.status === 'working');
    if (agent.status === 'working' && agent.progress >= 0) {
      bundle.barFill.width = Math.max(3, Math.round(36 * agent.progress));
    }
    bundle.barFill.setFillStyle(hexToNum(agent.accent), 1);

    bundle.ring.clear();
    if (selected) {
      bundle.ring.lineStyle(2, hexToNum(agent.accent), 0.95);
      bundle.ring.strokeEllipse(0, 0, 40, 16);
      bundle.ring.lineStyle(1, 0xffffff, 0.4);
      bundle.ring.strokeEllipse(0, 0, 32, 11);
    }

    // animation
    const base = `creature-${agent.id}`;
    const animKind = agent.status === 'walking' ? 'walk' : 'idle';
    const key = `${base}-${agent.facing}-${animKind}`;
    if (bundle.currentAnim !== key) { bundle.sprite.play(key, true); bundle.currentAnim = key; }

    // bubble
    const bubbleId = agent.bubble?.id ?? null;
    if (bundle.bubbleId !== bubbleId) {
      bundle.bubble?.destroy(); bundle.bubble = null; bundle.bubbleId = bubbleId;
      if (agent.bubble) {
        const colorMap: Record<string, number> = {
          idle: 0xfff8d0, work: 0xffefb0, react: 0xd0eaff, talk: 0xf0d8ff, done: 0xc8f8d0,
        };
        const container = this.add.container(0, -52);
        const text = this.add.text(0, 0, agent.bubble.text, {
          fontFamily: 'Courier New, monospace', fontSize: '10px', fontStyle: 'bold',
          color: '#1e1810', align: 'center', wordWrap: { width: 140 },
        });
        text.setOrigin(0.5, 1); text.setResolution(2);
        const w = Math.min(152, Math.max(44, text.width + 14));
        const h = Math.max(20, text.height + 10);
        const rect = this.add.rectangle(0, -text.height / 2 - 4, w, h,
          colorMap[agent.bubble.kind] ?? 0xfffbe8, 1);
        rect.setStrokeStyle(2, 0x2a2010, 0.82);
        const tail = this.add.triangle(0, 2, -6, -5, 6, -5, 0, 4, colorMap[agent.bubble.kind] ?? 0xfffbe8);
        tail.setStrokeStyle(2, 0x2a2010, 0.82);
        container.add([rect, tail, text]); container.setScale(0.88);
        bundle.container.add(container); bundle.bubble = container;
      }
    }

    bundle.lastAgent = agent;
  }

  /* …… Helpers ……………………………………………………………………………………………………………………………………………………………… */
  private drawFlower(ctx: CanvasRenderingContext2D, x: number, y: number, color: string) {
    px(ctx, '#2f7a3d', x + 2, y + 5, 2, 7);
    px(ctx, color, x, y, 3, 3); px(ctx, color, x + 4, y, 3, 3);
    px(ctx, color, x + 2, y + 3, 3, 3);
    px(ctx, '#fff8b5', x + 3, y + 2, 1, 1);
  }

  private addProp(texture: string, gx: number, gy: number, anim?: string): void {
    if (!this.textures.exists(texture)) return;
    const s = this.add.sprite(gx * TILE, gy * TILE, texture);
    s.setOrigin(0.5, 1); s.setDepth(gy * TILE + 8);
    if (anim) s.play(anim);
  }

  private addTex(key: string, w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void): void {
    if (this.textures.exists(key)) return;
    const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;
    draw(ctx);
    this.textures.addCanvas(key, canvas);
  }

  private createAnim(key: string, frames: string[], frameRate: number): void {
    if (!this.anims.exists(key)) {
      this.anims.create({ key, frames: frames.map((f) => ({ key: f })), frameRate, repeat: -1 });
    }
  }
}

/* …… React wrapper ………………………………………………………………………………………………………………………………………………… */
export function PhaserTamersWorld({ agents, theme: _theme, selectedId, onSelect, onDeselect }: PhaserTamersWorldProps): React.ReactElement {
  const hostRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<TamersScene | null>(null);
  const gameRef = useRef<Phaser.Game | null>(null);
  // Hold latest props for first sync after RAF creation (React.StrictMode guard)
  const propsRef = useRef({ agents, selectedId, onSelect, onDeselect });
  propsRef.current = { agents, selectedId, onSelect, onDeselect };

  useEffect(() => {
    if (!hostRef.current) return undefined;
    let raf = requestAnimationFrame(() => {
      raf = 0;
      if (gameRef.current || !hostRef.current) return;
      const scene = new TamersScene();
      sceneRef.current = scene;
      gameRef.current = new Phaser.Game({
        type: Phaser.AUTO, parent: hostRef.current,
        width: WORLD_W, height: WORLD_H,
        backgroundColor: '#2d4a1e', pixelArt: true, roundPixels: true,
        audio: { noAudio: true },
        scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
        scene,
      });
      // First sync with current props (scene.create() callback already happened, syncing pending will no-op)
      const p = propsRef.current;
      scene.sync(p.agents, p.selectedId, p.onSelect, p.onDeselect);
    });
    return () => {
      if (raf) cancelAnimationFrame(raf);     // StrictMode cleanup: creation cancelled before happening
      if (gameRef.current) {
        gameRef.current.destroy(true);
        gameRef.current = null;
        sceneRef.current = null;
      }
    };
  }, []);

  // Garde le canvas FIT aligné quand le CONTENEUR (pas la fenêtre) change de
  // taille : bascule de vue, collapse sidebar, montage lazy, fondu d'entrée.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;
    let raf = 0;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        gameRef.current?.scale.refresh();
      });
    });
    ro.observe(host);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, []);

  useEffect(() => {
    sceneRef.current?.sync(agents, selectedId, onSelect, onDeselect);
  }, [agents, selectedId, onSelect, onDeselect]);

  return (
    <div className="av-phaser-world av-phaser-world--tamers">
      <div ref={hostRef} className="av-phaser-host" />
      {!selectedId && <div className="av-world__hint">Clique sur une creature pour interagir</div>}
    </div>
  );
}

