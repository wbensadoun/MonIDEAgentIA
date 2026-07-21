import React, { useEffect, useRef } from 'react';
import Phaser from 'phaser';
import type { Agent, Facing, ThemeMeta } from '../types';

interface PhaserPixelWorldProps {
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

type TileKind =
  | 'grass-a'
  | 'grass-b'
  | 'path'
  | 'plaza'
  | 'floor-wood'
  | 'floor-stone'
  | 'water'
  | 'flower'
  | 'tall-grass';

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

function hexToNumber(color: string): number {
  return Number.parseInt(color.replace('#', ''), 16);
}

function px(ctx: CanvasRenderingContext2D, color: string, x: number, y: number, w: number, h: number): void {
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
}

function strokeRect(ctx: CanvasRenderingContext2D, color: string, x: number, y: number, w: number, h: number): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.strokeRect(Math.round(x) + 1, Math.round(y) + 1, Math.round(w) - 2, Math.round(h) - 2);
}

function lighten(color: string, amount: number): string {
  const n = hexToNumber(color);
  const r = Math.min(255, ((n >> 16) & 255) + amount);
  const g = Math.min(255, ((n >> 8) & 255) + amount);
  const b = Math.min(255, (n & 255) + amount);
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

function darken(color: string, factor: number): string {
  const n = hexToNumber(color);
  const r = Math.round(((n >> 16) & 255) * factor);
  const g = Math.round(((n >> 8) & 255) * factor);
  const b = Math.round((n & 255) * factor);
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

/* Per-character look so the six agents read as distinct people, not palette
 * swaps. Each picks a hairstyle, a signature accessory and an outfit cut. */
type HairStyle = 'bun' | 'long' | 'short' | 'bob' | 'beanie';
type AccStyle = 'glasses' | 'bigglasses' | 'headphones' | 'beard' | 'goggles' | 'none';
type OutfitStyle = 'blazer' | 'hoodie' | 'tee' | 'vest';
interface CharStyle { hair: HairStyle; acc: AccStyle; outfit: OutfitStyle; hatColor?: string }

const CHAR: Record<string, CharStyle> = {
  pm: { hair: 'bun', acc: 'glasses', outfit: 'blazer' },
  ux: { hair: 'long', acc: 'bigglasses', outfit: 'tee' },
  frontend: { hair: 'short', acc: 'headphones', outfit: 'hoodie' },
  backend: { hair: 'short', acc: 'beard', outfit: 'tee' },
  qa: { hair: 'bob', acc: 'none', outfit: 'vest' },
  devops: { hair: 'beanie', acc: 'goggles', outfit: 'tee', hatColor: '#46607a' },
};

function shorten(text: string, max = 22): string {
  return text.length > max ? `${text.slice(0, max - 1)}.` : text;
}

function pixelPosition(agent: Agent): { x: number; y: number } {
  return {
    x: (agent.pos.x + 0.5) * TILE,
    y: (agent.pos.y + 0.64) * TILE,
  };
}

class PixelTownScene extends Phaser.Scene {
  private bundles = new Map<string, AgentBundle>();
  private pending: PendingSync | null = null;
  private isReady = false;
  private onSelect?: (id: string) => void;
  private onDeselect?: () => void;

  constructor() {
    super({ key: 'agentverse-pixel-town' });
  }

  create(): void {
    this.cameras.main.setBackgroundColor('#2a3f28');
    this.generateWorldTextures();
    this.paintTiles();
    this.paintProps();
    this.paintZoneLabels();
    this.input.on(
      'pointerdown',
      (_pointer: Phaser.Input.Pointer, currentlyOver: Phaser.GameObjects.GameObject[]) => {
        if (!currentlyOver.length) this.onDeselect?.();
      },
    );
    this.isReady = true;

    if (this.pending) {
      const pending = this.pending;
      this.pending = null;
      this.sync(pending.agents, pending.selectedId, pending.onSelect, pending.onDeselect);
    }
  }

  update(time: number): void {
    this.bundles.forEach((bundle) => {
      if (bundle.lastAgent.status === 'working' && bundle.lastAgent.progress < 0) {
        const pulse = (Math.sin(time / 180) + 1) / 2;
        bundle.barFill.width = 10 + pulse * 23;
      }
      if (bundle.lastAgent.status === 'talking') {
        bundle.sprite.y = -1 + Math.sin(time / 210) * 1.5;
      } else {
        bundle.sprite.y = 0;
      }
    });
  }

  sync(
    agents: Agent[],
    selectedId: string | null,
    onSelect: (id: string) => void,
    onDeselect: () => void,
  ): void {
    this.onSelect = onSelect;
    this.onDeselect = onDeselect;

    if (!this.isReady) {
      this.pending = { agents, selectedId, onSelect, onDeselect };
      return;
    }

    const activeIds = new Set(agents.map((agent) => agent.id));
    this.bundles.forEach((bundle, id) => {
      if (!activeIds.has(id)) {
        bundle.container.destroy();
        this.bundles.delete(id);
      }
    });

    agents.forEach((agent) => {
      const bundle = this.bundles.get(agent.id) ?? this.createAgentBundle(agent);
      this.updateAgentBundle(bundle, agent, selectedId === agent.id);
    });
  }

  private generateWorldTextures(): void {
    this.addTexture('tile-grass-a', TILE, TILE, (ctx) => {
      px(ctx, '#73c867', 0, 0, TILE, TILE);
      px(ctx, '#8ad577', 3, 5, 2, 2);
      px(ctx, '#5eb957', 17, 12, 3, 2);
      px(ctx, '#91d477', 24, 25, 3, 3);
      px(ctx, '#5ab052', 7, 23, 2, 4);
    });
    this.addTexture('tile-grass-b', TILE, TILE, (ctx) => {
      px(ctx, '#6fc361', 0, 0, TILE, TILE);
      px(ctx, '#84d270', 7, 9, 3, 2);
      px(ctx, '#559f4b', 21, 4, 2, 4);
      px(ctx, '#8dd97d', 23, 21, 2, 2);
      px(ctx, '#61b455', 10, 27, 5, 2);
    });
    this.addTexture('tile-path', TILE, TILE, (ctx) => {
      px(ctx, '#d8b772', 0, 0, TILE, TILE);
      px(ctx, '#edcf87', 0, 0, TILE, 4);
      px(ctx, '#bf9552', 0, 28, TILE, 4);
      px(ctx, '#cda565', 5, 9, 5, 3);
      px(ctx, '#e8c47d', 20, 16, 6, 3);
      px(ctx, '#b98a4e', 11, 25, 4, 2);
    });
    this.addTexture('tile-plaza', TILE, TILE, (ctx) => {
      px(ctx, '#c9b47c', 0, 0, TILE, TILE);
      px(ctx, '#d7c48d', 0, 0, TILE, 2);
      px(ctx, '#ae935f', 0, 30, TILE, 2);
      strokeRect(ctx, '#b99f69', 0, 0, TILE, TILE);
      px(ctx, '#dccc9a', 5, 7, 8, 3);
      px(ctx, '#a88958', 20, 20, 7, 3);
    });
    this.addTexture('tile-floor-wood', TILE, TILE, (ctx) => {
      px(ctx, '#ba8247', 0, 0, TILE, TILE);
      for (let y = 0; y < TILE; y += 8) {
        px(ctx, y % 16 === 0 ? '#c99455' : '#a9703d', 0, y, TILE, 2);
      }
      px(ctx, '#8b5d34', 10, 1, 2, TILE - 2);
      px(ctx, '#8b5d34', 24, 1, 2, TILE - 2);
    });
    this.addTexture('tile-floor-stone', TILE, TILE, (ctx) => {
      px(ctx, '#9ea79a', 0, 0, TILE, TILE);
      strokeRect(ctx, '#7e877a', 0, 0, TILE, TILE);
      px(ctx, '#c2c9bc', 4, 5, 9, 3);
      px(ctx, '#828c7e', 19, 20, 9, 3);
    });
    [0, 1, 2].forEach((frame) => {
      this.addTexture(`tile-water-${frame}`, TILE, TILE, (ctx) => {
        px(ctx, '#4aa5d8', 0, 0, TILE, TILE);
        px(ctx, '#2f87bf', 0, 26, TILE, 6);
        px(ctx, '#7ed4ee', 3 + frame * 4, 7, 12, 2);
        px(ctx, '#b5eef7', 19 - frame * 2, 17, 8, 2);
        px(ctx, '#378fca', 7, 23 - frame, 16, 2);
      });
    });
    [0, 1].forEach((frame) => {
      this.addTexture(`tile-flower-${frame}`, TILE, TILE, (ctx) => {
        px(ctx, '#69bd58', 0, 0, TILE, TILE);
        px(ctx, '#5cad4e', 0, 0, TILE, TILE);
        const sway = frame ? 2 : 0;
        this.drawFlower(ctx, 6 + sway, 8, '#f472b6');
        this.drawFlower(ctx, 18 - sway, 13, '#fde047');
        this.drawFlower(ctx, 12, 23 - sway, '#f97316');
      });
    });
    [0, 1].forEach((frame) => {
      this.addTexture(`tile-tall-grass-${frame}`, TILE, TILE, (ctx) => {
        px(ctx, '#64b957', 0, 0, TILE, TILE);
        for (let i = 0; i < 9; i += 1) {
          const x = 3 + i * 3;
          const h = 9 + ((i + frame) % 3) * 3;
          px(ctx, i % 2 ? '#3d9343' : '#4fa64c', x + frame, 23 - h, 2, h);
        }
      });
    });

    this.addTexture('prop-tree', 46, 58, (ctx) => {
      px(ctx, '#5b3b26', 19, 31, 8, 20);
      px(ctx, '#7a5430', 22, 31, 3, 20);
      px(ctx, '#276f3a', 7, 18, 32, 20);
      px(ctx, '#2f8a45', 3, 11, 30, 21);
      px(ctx, '#3aa653', 13, 5, 27, 20);
      px(ctx, '#91d477', 20, 8, 8, 4);
      px(ctx, '#1f5e31', 7, 32, 32, 5);
      px(ctx, '#402719', 14, 50, 18, 4);
    });
    this.addTexture('prop-cottage', 66, 58, (ctx) => {
      px(ctx, '#7e4f2d', 6, 23, 54, 28);
      px(ctx, '#f3d08b', 10, 28, 46, 21);
      px(ctx, '#a74337', 4, 16, 58, 12);
      px(ctx, '#c85a3f', 12, 9, 42, 12);
      px(ctx, '#762f30', 18, 5, 30, 8);
      px(ctx, '#65391f', 29, 34, 10, 17);
      px(ctx, '#6fbfe8', 14, 31, 10, 8);
      px(ctx, '#6fbfe8', 43, 31, 10, 8);
      strokeRect(ctx, '#5b3b26', 6, 22, 54, 30);
    });
    this.addTexture('prop-lab', 68, 60, (ctx) => {
      px(ctx, '#4d6b78', 7, 22, 54, 30);
      px(ctx, '#d8e5dd', 11, 25, 46, 24);
      px(ctx, '#6ec6d8', 22, 31, 23, 9);
      px(ctx, '#31505b', 29, 39, 10, 12);
      px(ctx, '#d04444', 4, 13, 60, 12);
      px(ctx, '#f05c5c', 12, 7, 44, 10);
      px(ctx, '#f4f7f0', 50, 3, 9, 18);
      px(ctx, '#6ec6d8', 53, 0, 5, 5);
      strokeRect(ctx, '#334852', 7, 22, 54, 30);
    });
    this.addTexture('prop-stall', 58, 42, (ctx) => {
      px(ctx, '#7a4b2a', 9, 19, 40, 18);
      px(ctx, '#f7d06d', 6, 8, 46, 10);
      px(ctx, '#db5d4a', 6, 8, 8, 10);
      px(ctx, '#db5d4a', 24, 8, 8, 10);
      px(ctx, '#db5d4a', 42, 8, 10, 10);
      px(ctx, '#5b3922', 12, 28, 32, 8);
      px(ctx, '#34d399', 15, 22, 6, 5);
      px(ctx, '#f87171', 27, 22, 6, 5);
      px(ctx, '#60a5fa', 39, 22, 6, 5);
      px(ctx, '#4a2b18', 9, 37, 40, 3);
    });
    this.addTexture('prop-sign', 24, 30, (ctx) => {
      px(ctx, '#6b4428', 10, 10, 4, 18);
      px(ctx, '#c99a5b', 3, 4, 18, 12);
      strokeRect(ctx, '#6b4428', 3, 4, 18, 12);
      px(ctx, '#6b4428', 7, 8, 10, 2);
    });
    this.addTexture('prop-fence', 36, 24, (ctx) => {
      px(ctx, '#83572e', 3, 6, 4, 16);
      px(ctx, '#83572e', 15, 6, 4, 16);
      px(ctx, '#83572e', 28, 6, 4, 16);
      px(ctx, '#b98542', 0, 10, 36, 4);
      px(ctx, '#b98542', 0, 17, 36, 4);
      px(ctx, '#5a351f', 0, 21, 36, 3);
    });
    this.addTexture('prop-bridge', 68, 26, (ctx) => {
      px(ctx, '#895b31', 0, 7, 68, 14);
      px(ctx, '#b78444', 0, 2, 68, 6);
      for (let x = 4; x < 68; x += 11) px(ctx, '#5f3a20', x, 3, 3, 18);
      px(ctx, '#4e2f1b', 0, 21, 68, 3);
    });
    this.addTexture('prop-rock', 28, 22, (ctx) => {
      px(ctx, '#7f8a84', 3, 8, 21, 10);
      px(ctx, '#a4ada7', 8, 4, 13, 7);
      px(ctx, '#5f6963', 6, 17, 18, 3);
    });
    this.addTexture('prop-job-station', 40, 30, (ctx) => {
      px(ctx, '#5f3d28', 4, 15, 32, 9);
      px(ctx, '#90643b', 3, 9, 34, 8);
      px(ctx, '#2d4e64', 12, 2, 16, 12);
      px(ctx, '#75d0f0', 15, 5, 10, 5);
      px(ctx, '#3a2519', 5, 24, 6, 5);
      px(ctx, '#3a2519', 29, 24, 6, 5);
    });
    [0, 1, 2].forEach((frame) => {
      this.addTexture(`prop-lamp-${frame}`, 18, 34, (ctx) => {
        px(ctx, '#5b3922', 8, 14, 3, 18);
        px(ctx, '#3f281b', 5, 30, 9, 3);
        px(ctx, frame === 1 ? '#ffe58f' : '#fbbf24', 5, 6, 9, 9);
        px(ctx, '#fff3c4', 8, 8, 3, 3);
        px(ctx, '#8b5d34', 4, 5, 11, 2);
      });
    });
    [0, 1, 2].forEach((frame) => {
      this.addTexture(`prop-sparkle-${frame}`, 8, 8, (ctx) => {
        if (frame === 0) px(ctx, '#ffffff', 3, 3, 2, 2);
        if (frame === 1) {
          px(ctx, '#ffffff', 3, 1, 2, 6);
          px(ctx, '#ffffff', 1, 3, 6, 2);
        }
        if (frame === 2) {
          px(ctx, '#e5f7ff', 2, 0, 4, 8);
          px(ctx, '#e5f7ff', 0, 2, 8, 4);
        }
      });
    });
    this.addTexture('prop-smoke', 12, 12, (ctx) => {
      px(ctx, 'rgba(220, 235, 226, 0.55)', 3, 3, 6, 6);
      px(ctx, 'rgba(220, 235, 226, 0.35)', 1, 5, 9, 4);
      px(ctx, 'rgba(220, 235, 226, 0.45)', 5, 1, 5, 8);
    });

    this.createLoop('water-loop', ['tile-water-0', 'tile-water-1', 'tile-water-2', 'tile-water-1'], 5);
    this.createLoop('flower-loop', ['tile-flower-0', 'tile-flower-1'], 2);
    this.createLoop('grass-loop', ['tile-tall-grass-0', 'tile-tall-grass-1'], 3);
    this.createLoop('lamp-loop', ['prop-lamp-0', 'prop-lamp-1', 'prop-lamp-2', 'prop-lamp-1'], 6);
    this.createLoop('sparkle-loop', ['prop-sparkle-0', 'prop-sparkle-1', 'prop-sparkle-2', 'prop-sparkle-1'], 7);
  }

  private paintTiles(): void {
    for (let y = 0; y < ROWS; y += 1) {
      for (let x = 0; x < COLS; x += 1) {
        const kind = this.tileAt(x, y);
        const sprite = this.add.sprite(x * TILE + TILE / 2, y * TILE + TILE / 2, this.tileTexture(kind));
        sprite.setDepth(y * 0.01);
        if (kind === 'water') sprite.play('water-loop');
        if (kind === 'flower') sprite.play('flower-loop');
        if (kind === 'tall-grass') sprite.play('grass-loop');
      }
    }
  }

  private paintProps(): void {
    this.addProp('prop-lab', 2.1, 2.15);
    this.addProp('prop-cottage', 6.8, 2.1);
    this.addProp('prop-cottage', 12.3, 2.2);
    this.addProp('prop-stall', 9.6, 4.85);
    this.addProp('prop-sign', 4.7, 4.25);
    this.addProp('prop-bridge', 2.1, 8.15);
    this.addProp('prop-cottage', 12.4, 8.0);

    [
      [0.5, 1.35], [0.8, 3.3], [1.2, 9.7], [4.3, 0.95],
      [5.5, 9.8], [9.9, 0.85], [13.7, 0.95], [14.7, 3.25],
      [14.6, 6.25], [15.1, 9.2],
    ].forEach(([x, y]) => this.addProp('prop-tree', x, y));

    [
      [3.7, 6.25], [4.65, 6.25], [5.6, 6.25], [11.0, 8.8],
      [11.95, 8.8], [13.55, 8.8], [14.5, 8.8],
    ].forEach(([x, y]) => this.addProp('prop-fence', x, y));

    [
      [5.8, 4.6], [7.2, 6.1], [10.8, 2.8], [13.9, 5.8],
    ].forEach(([x, y]) => this.addProp('prop-lamp-0', x, y, 'lamp-loop'));

    [
      [3.15, 3.95], [7.15, 3.95], [12.15, 3.95],
      [3.15, 7.95], [7.15, 7.95], [12.15, 7.95],
    ].forEach(([x, y]) => this.addProp('prop-job-station', x, y));

    [
      [5.35, 8.7], [8.25, 8.45], [10.85, 6.8], [13.9, 7.6],
    ].forEach(([x, y]) => this.addProp('prop-rock', x, y));

    [
      [4.8, 2.9], [10.35, 3.35], [12.95, 5.45], [7.9, 8.1],
    ].forEach(([x, y], i) => {
      const sparkle = this.add.sprite(x * TILE, y * TILE, 'prop-sparkle-0').play('sparkle-loop');
      sparkle.setDepth(90 + i);
      sparkle.setAlpha(0.78);
    });

    this.addSmoke(6.95 * TILE, 1.02 * TILE);
    this.addSmoke(12.45 * TILE, 1.1 * TILE, 500);
  }

  private paintZoneLabels(): void {
    this.addZoneLabel('Village', 2.6, 0.65);
    this.addZoneLabel('Lab IA', 2.3, 3.55);
    this.addZoneLabel('Route Nord', 12.2, 0.65);
    this.addZoneLabel('Atelier', 2.65, 6.05);
    this.addZoneLabel('Prairie QA', 7.3, 6.05);
    this.addZoneLabel('Station', 12.5, 6.05);
  }

  private addZoneLabel(text: string, x: number, y: number): void {
    const label = this.add.text(x * TILE, y * TILE, text, {
      fontFamily: 'Courier New, monospace',
      fontSize: '9px',
      color: '#fff8d9',
      backgroundColor: '#2f2618',
      padding: { left: 4, right: 4, top: 2, bottom: 2 },
    });
    label.setOrigin(0.5, 0.5);
    label.setDepth(12);
    label.setResolution(2);
  }

  private addSmoke(x: number, y: number, delay = 0): void {
    const smoke = this.add.sprite(x, y, 'prop-smoke');
    smoke.setDepth(40);
    smoke.setAlpha(0);
    this.tweens.add({
      targets: smoke,
      y: y - 18,
      x: x + 7,
      alpha: { from: 0, to: 0.62 },
      duration: 1650,
      delay,
      repeat: -1,
      yoyo: false,
      onRepeat: () => {
        smoke.setPosition(x, y);
        smoke.setAlpha(0);
      },
    });
  }

  private addProp(texture: string, gridX: number, gridY: number, anim?: string): Phaser.GameObjects.Sprite {
    const sprite = this.add.sprite(gridX * TILE, gridY * TILE, texture);
    sprite.setOrigin(0.5, 1);
    sprite.setDepth(gridY * TILE + 8);
    if (anim) sprite.play(anim);
    return sprite;
  }

  private tileAt(x: number, y: number): TileKind {
    const water = x <= 2 && y >= 6 && y <= 8 && !(x === 2 && y === 8);
    if (water) return 'water';

    const path =
      x === 7 || x === 8 ||
      y === 4 || y === 5 ||
      (y === 2 && x >= 9) ||
      (x >= 1 && x <= 3 && y === 3) ||
      (x >= 11 && x <= 13 && y === 7);
    if (path) return (x >= 6 && x <= 9 && y >= 3 && y <= 6) ? 'plaza' : 'path';

    const lab = x >= 1 && x <= 4 && y >= 1 && y <= 3;
    const cottage = x >= 6 && x <= 9 && y >= 1 && y <= 3;
    const station = x >= 11 && x <= 14 && y >= 6 && y <= 8;
    if (lab || station) return 'floor-stone';
    if (cottage || (x >= 1 && x <= 4 && y >= 6 && y <= 8)) return 'floor-wood';

    if ((x >= 5 && x <= 9 && y >= 7 && y <= 9) || (x >= 10 && x <= 13 && y === 3)) {
      return (x + y) % 3 === 0 ? 'flower' : 'tall-grass';
    }

    return (x + y) % 2 === 0 ? 'grass-a' : 'grass-b';
  }

  private tileTexture(kind: TileKind): string {
    if (kind === 'water') return 'tile-water-0';
    if (kind === 'flower') return 'tile-flower-0';
    if (kind === 'tall-grass') return 'tile-tall-grass-0';
    return `tile-${kind}`;
  }

  private createAgentBundle(agent: Agent): AgentBundle {
    this.ensureAgentTextures(agent);
    const { x, y } = pixelPosition(agent);
    const base = `agent-${agent.id}`;
    const container = this.add.container(x, y);
    container.setDepth(y);

    const shadow = this.add.ellipse(0, 0, 26, 9, 0x000000, 0.22);
    const ring = this.add.graphics();
    const sprite = this.add.sprite(0, 0, `${base}-${agent.facing}-0`);
    sprite.setOrigin(0.5, 1);
    sprite.setInteractive({ cursor: 'pointer' });
    sprite.on('pointerdown', () => this.onSelect?.(agent.id));

    const barBg = this.add.rectangle(0, 5, 36, 4, 0x251d17, 0.88);
    barBg.setOrigin(0.5, 0.5);
    const barFill = this.add.rectangle(-17, 5, 0, 3, hexToNumber(agent.accent), 1);
    barFill.setOrigin(0, 0.5);

    const name = this.add.text(0, 11, agent.name, {
      fontFamily: 'Courier New, monospace',
      fontSize: '10px',
      fontStyle: 'bold',
      color: '#fff6d6',
      backgroundColor: '#231c16',
      padding: { left: 4, right: 4, top: 1, bottom: 1 },
    });
    name.setOrigin(0.5, 0);
    name.setResolution(2);

    const role = this.add.text(0, 24, shorten(agent.role, 18), {
      fontFamily: 'Courier New, monospace',
      fontSize: '8px',
      color: '#f0dca5',
      backgroundColor: '#231c16',
      padding: { left: 3, right: 3, top: 1, bottom: 1 },
    });
    role.setOrigin(0.5, 0);
    role.setResolution(2);

    container.add([shadow, ring, sprite, barBg, barFill, name, role]);

    const bundle: AgentBundle = {
      container,
      sprite,
      shadow,
      ring,
      name,
      role,
      barBg,
      barFill,
      bubble: null,
      bubbleId: null,
      currentAnim: null,
      lastAgent: agent,
    };
    this.bundles.set(agent.id, bundle);
    return bundle;
  }

  private updateAgentBundle(bundle: AgentBundle, agent: Agent, selected: boolean): void {
    this.ensureAgentTextures(agent);
    const { x, y } = pixelPosition(agent);

    this.tweens.killTweensOf(bundle.container);
    if (Math.abs(bundle.container.x - x) > 2 || Math.abs(bundle.container.y - y) > 2) {
      this.tweens.add({
        targets: bundle.container,
        x,
        y,
        duration: agent.status === 'walking' ? 320 : 220,
        ease: 'Linear',
        onUpdate: () => bundle.container.setDepth(bundle.container.y),
      });
    } else {
      bundle.container.setPosition(x, y);
    }
    bundle.container.setDepth(y);

    bundle.name.setText(agent.name);
    bundle.role.setText(shorten(agent.role, 18));
    bundle.barBg.setVisible(agent.status === 'working');
    bundle.barFill.setVisible(agent.status === 'working');
    if (agent.status === 'working' && agent.progress >= 0) {
      bundle.barFill.width = Math.max(3, Math.round(34 * agent.progress));
    }
    bundle.barFill.setFillStyle(hexToNumber(agent.accent), 1);
    bundle.shadow.setFillStyle(0x000000, agent.status === 'walking' ? 0.18 : 0.24);

    bundle.ring.clear();
    if (selected) {
      bundle.ring.lineStyle(2, hexToNumber(agent.accent), 0.96);
      bundle.ring.strokeEllipse(0, -1, 38, 14);
      bundle.ring.lineStyle(1, 0xffffff, 0.45);
      bundle.ring.strokeEllipse(0, -1, 30, 10);
    }

    this.updateAgentAnimation(bundle, agent);
    this.updateBubble(bundle, agent);
    bundle.lastAgent = agent;
  }

  private updateAgentAnimation(bundle: AgentBundle, agent: Agent): void {
    const facing = agent.facing;
    const base = `agent-${agent.id}`;
    const animKind = agent.status === 'walking' ? 'walk' : 'idle';
    const key = `${base}-${facing}-${animKind}`;
    if (bundle.currentAnim !== key) {
      bundle.sprite.play(key, true);
      bundle.currentAnim = key;
    }
  }

  private updateBubble(bundle: AgentBundle, agent: Agent): void {
    const bubbleId = agent.bubble?.id ?? null;
    if (bundle.bubbleId === bubbleId) return;

    bundle.bubble?.destroy();
    bundle.bubble = null;
    bundle.bubbleId = bubbleId;

    if (!agent.bubble) return;

    const colorByKind: Record<NonNullable<Agent['bubble']>['kind'], number> = {
      idle: 0xffffff,
      work: 0xffefb3,
      react: 0xdbeafe,
      talk: 0xf2ddff,
      done: 0xc8f7d1,
    };
    const container = this.add.container(0, -47);
    const text = this.add.text(0, 0, agent.bubble.text, {
      fontFamily: 'Courier New, monospace',
      fontSize: '10px',
      fontStyle: 'bold',
      color: '#1e1a16',
      align: 'center',
      wordWrap: { width: 138 },
    });
    text.setOrigin(0.5, 1);
    text.setResolution(2);

    const w = Math.min(150, Math.max(42, text.width + 14));
    const h = Math.max(19, text.height + 9);
    const rect = this.add.rectangle(0, -text.height / 2 - 4, w, h, colorByKind[agent.bubble.kind], 1);
    rect.setStrokeStyle(2, 0x2d261c, 0.82);
    const tail = this.add.triangle(0, 2, -6, -5, 6, -5, 0, 3, colorByKind[agent.bubble.kind], 1);
    tail.setStrokeStyle(2, 0x2d261c, 0.82);
    container.add([rect, tail, text]);
    container.setScale(0.88);
    bundle.container.add(container);
    bundle.bubble = container;
  }

  private ensureAgentTextures(agent: Agent): void {
    const base = `agent-${agent.id}`;
    (['down', 'up', 'left', 'right'] as Facing[]).forEach((facing) => {
      [0, 1, 2, 3].forEach((frame) => {
        const key = `${base}-${facing}-${frame}`;
        this.addTexture(key, 32, 42, (ctx) => this.drawAgent(ctx, agent, facing, frame));
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
          frameRate: 2,
          repeat: -1,
        });
      }
      if (!this.anims.exists(walk)) {
        this.anims.create({
          key: walk,
          frames: [
            { key: `${base}-${facing}-0` },
            { key: `${base}-${facing}-1` },
            { key: `${base}-${facing}-0` },
            { key: `${base}-${facing}-2` },
          ],
          frameRate: 8,
          repeat: -1,
        });
      }
    });
  }

  private drawAgent(ctx: CanvasRenderingContext2D, agent: Agent, facing: Facing, frame: number): void {
    const walkShift = frame === 1 ? 2 : frame === 2 ? -2 : 0;
    const blink = frame === 3;
    const t = CHAR[agent.roleKey] ?? CHAR.pm;
    const skin = agent.palette.skin;
    const skinDk = darken(skin, 0.84);
    const hair = agent.palette.hair;
    const outfit = agent.palette.outfit;
    const accent = agent.palette.accent;

    px(ctx, 'rgba(0,0,0,0)', 0, 0, 32, 42);

    // legs + shoes
    px(ctx, '#2b241c', 11, 34, 4, 4 + Math.max(0, walkShift));
    px(ctx, '#2b241c', 17, 34, 4, 4 - Math.min(0, walkShift));
    px(ctx, '#15110d', 10, 37 + Math.max(0, walkShift), 6, 2);
    px(ctx, '#15110d', 16, 37 - Math.min(0, walkShift), 6, 2);

    // torso
    px(ctx, outfit, 9, 19, 14, 15);
    px(ctx, lighten(outfit, 24), 11, 20, 5, 2);
    px(ctx, darken(outfit, 0.7), 9, 31, 14, 3);
    this.drawOutfit(ctx, t, outfit, accent, facing);

    // arms (sleeves = outfit, one visible hand = skin)
    if (facing === 'up') {
      px(ctx, outfit, 7, 21 - walkShift, 3, 9);
      px(ctx, outfit, 22, 21 + walkShift, 3, 9);
    } else if (facing === 'left') {
      px(ctx, outfit, 6, 22 - walkShift, 4, 8);
      px(ctx, skin, 7, 29 - walkShift, 3, 3);
    } else if (facing === 'right') {
      px(ctx, outfit, 22, 22 + walkShift, 4, 8);
      px(ctx, skin, 23, 29 + walkShift, 3, 3);
    } else {
      px(ctx, outfit, 6, 22 - walkShift, 3, 9);
      px(ctx, skin, 6, 30 - walkShift, 3, 3);
      px(ctx, outfit, 23, 22 + walkShift, 3, 9);
      px(ctx, skin, 23, 30 + walkShift, 3, 3);
    }

    // head + face + hair + accessory
    if (facing === 'left' || facing === 'right') {
      this.drawHeadSide(ctx, t, facing === 'left', blink, skin, skinDk, hair);
    } else if (facing === 'up') {
      this.drawHeadUp(ctx, t, hair, skin);
    } else {
      this.drawHeadDown(ctx, t, blink, skin, skinDk, hair);
    }

    this.drawRoleMark(ctx, agent, facing);
    strokeRect(ctx, '#1a1511', 8, 18, 16, 17);
  }

  /** Collar / outfit cut detail (front + side only). */
  private drawOutfit(ctx: CanvasRenderingContext2D, t: CharStyle, outfit: string, accent: string, facing: Facing): void {
    if (facing === 'up') return;
    switch (t.outfit) {
      case 'blazer':
        px(ctx, darken(outfit, 0.6), 9, 19, 14, 2);
        px(ctx, '#f4f1ea', 13, 19, 6, 4); // shirt V
        px(ctx, accent, 15, 19, 2, 7); // tie
        px(ctx, darken(accent, 0.7), 15, 25, 2, 1);
        break;
      case 'hoodie':
        px(ctx, darken(outfit, 0.78), 9, 19, 14, 3); // hood roll
        px(ctx, '#eef2f4', 13, 21, 1, 5); // drawstrings
        px(ctx, '#eef2f4', 18, 21, 1, 5);
        px(ctx, lighten(outfit, 14), 14, 26, 4, 5); // pocket
        break;
      case 'vest':
        px(ctx, darken(outfit, 0.62), 11, 19, 2, 14);
        px(ctx, darken(outfit, 0.62), 19, 19, 2, 14);
        px(ctx, '#f4f1ea', 13, 19, 6, 3);
        break;
      default: // tee
        px(ctx, lighten(outfit, 16), 13, 19, 6, 2); // collar
        break;
    }
  }

  /* ---- Front-facing head ---- */
  private drawHeadDown(ctx: CanvasRenderingContext2D, t: CharStyle, blink: boolean, skin: string, skinDk: string, hair: string): void {
    px(ctx, skin, 10, 10, 12, 11);
    px(ctx, skinDk, 10, 19, 12, 2); // jaw shade
    px(ctx, skin, 9, 14, 2, 3); // ears
    px(ctx, skin, 21, 14, 2, 3);

    if (blink) {
      px(ctx, skinDk, 12, 16, 3, 1);
      px(ctx, skinDk, 17, 16, 3, 1);
    } else {
      px(ctx, '#ffffff', 12, 15, 3, 2);
      px(ctx, '#ffffff', 17, 15, 3, 2);
      px(ctx, '#171311', 13, 15, 2, 2);
      px(ctx, '#171311', 18, 15, 2, 2);
    }
    px(ctx, skinDk, 15, 18, 2, 1); // mouth

    this.drawHairDown(ctx, t, hair);
    this.drawAccDown(ctx, t, hair);
  }

  private drawHairDown(ctx: CanvasRenderingContext2D, t: CharStyle, hair: string): void {
    const hi = lighten(hair, 30);
    switch (t.hair) {
      case 'bun':
        px(ctx, hair, 13, 2, 6, 5);
        px(ctx, hi, 14, 3, 2, 2);
        px(ctx, hair, 9, 6, 14, 5);
        px(ctx, hair, 9, 9, 2, 4);
        px(ctx, hair, 21, 9, 2, 4);
        px(ctx, hi, 11, 7, 9, 1);
        break;
      case 'long':
        px(ctx, hair, 8, 5, 16, 7);
        px(ctx, hair, 7, 11, 4, 18);
        px(ctx, hair, 21, 11, 4, 18);
        px(ctx, hair, 9, 9, 3, 4);
        px(ctx, hair, 20, 9, 3, 4);
        px(ctx, hi, 9, 6, 6, 1);
        px(ctx, hi, 8, 13, 1, 12);
        break;
      case 'short':
        px(ctx, hair, 9, 6, 14, 5);
        px(ctx, hair, 9, 5, 3, 2);
        px(ctx, hair, 14, 4, 4, 3);
        px(ctx, hair, 19, 5, 3, 2);
        px(ctx, hair, 9, 9, 2, 3);
        px(ctx, hair, 21, 9, 2, 3);
        px(ctx, hi, 12, 6, 7, 1);
        break;
      case 'bob':
        px(ctx, hair, 8, 5, 16, 7);
        px(ctx, hair, 8, 11, 3, 9);
        px(ctx, hair, 21, 11, 3, 9);
        px(ctx, hi, 9, 6, 7, 1);
        break;
      case 'beanie': {
        const cap = t.hatColor ?? '#46607a';
        px(ctx, cap, 8, 4, 16, 7);
        px(ctx, lighten(cap, 26), 9, 4, 14, 2);
        px(ctx, darken(cap, 0.68), 8, 10, 16, 2);
        px(ctx, hair, 9, 12, 2, 3);
        px(ctx, hair, 21, 12, 2, 3);
        break;
      }
      default:
        px(ctx, hair, 9, 6, 14, 6);
    }
  }

  private drawAccDown(ctx: CanvasRenderingContext2D, t: CharStyle, hair: string): void {
    switch (t.acc) {
      case 'glasses':
        px(ctx, '#2a2f3a', 11, 14, 5, 4);
        px(ctx, '#2a2f3a', 17, 14, 5, 4);
        px(ctx, '#bfe9ff', 12, 15, 3, 2);
        px(ctx, '#bfe9ff', 18, 15, 3, 2);
        px(ctx, '#2a2f3a', 16, 15, 1, 1);
        break;
      case 'bigglasses':
        px(ctx, '#37313f', 10, 13, 6, 5);
        px(ctx, '#37313f', 16, 13, 6, 5);
        px(ctx, '#ffe3f3', 11, 14, 4, 3);
        px(ctx, '#ffe3f3', 17, 14, 4, 3);
        px(ctx, '#171311', 12, 15, 2, 2);
        px(ctx, '#171311', 18, 15, 2, 2);
        break;
      case 'headphones':
        px(ctx, '#242424', 8, 6, 16, 2);
        px(ctx, '#242424', 7, 8, 3, 8);
        px(ctx, '#242424', 22, 8, 3, 8);
        px(ctx, '#ff5d8f', 8, 10, 1, 4);
        px(ctx, '#ff5d8f', 23, 10, 1, 4);
        break;
      case 'beard':
        px(ctx, hair, 10, 18, 12, 4);
        px(ctx, hair, 9, 16, 2, 4);
        px(ctx, hair, 21, 16, 2, 4);
        px(ctx, darken(hair, 0.78), 13, 20, 6, 1);
        break;
      case 'goggles':
        px(ctx, '#4a3320', 8, 6, 16, 2);
        px(ctx, '#7a5230', 10, 4, 5, 3);
        px(ctx, '#7a5230', 17, 4, 5, 3);
        px(ctx, '#9fe8ff', 11, 5, 3, 1);
        px(ctx, '#9fe8ff', 18, 5, 3, 1);
        break;
      default:
        break;
    }
  }

  /* ---- Side-facing head (mirror via `m` when facing left) ---- */
  private drawHeadSide(ctx: CanvasRenderingContext2D, t: CharStyle, faceLeft: boolean, blink: boolean, skin: string, skinDk: string, hair: string): void {
    const m = (x: number, w: number): number => (faceLeft ? 32 - x - w : x);
    px(ctx, skin, m(10, 12), 10, 12, 11);
    px(ctx, skinDk, m(10, 12), 19, 12, 2);
    px(ctx, skin, m(9, 2), 14, 2, 3); // back ear

    if (blink) {
      px(ctx, skinDk, m(17, 3), 16, 3, 1);
    } else {
      px(ctx, '#ffffff', m(17, 3), 15, 3, 2);
      px(ctx, '#171311', m(18, 2), 15, 2, 2);
    }
    px(ctx, skinDk, m(20, 2), 18, 2, 1); // mouth toward front

    this.drawHairSide(ctx, t, hair, m);
    this.drawAccSide(ctx, t, hair, m);
  }

  private drawHairSide(ctx: CanvasRenderingContext2D, t: CharStyle, hair: string, m: (x: number, w: number) => number): void {
    const hi = lighten(hair, 30);
    switch (t.hair) {
      case 'bun':
        px(ctx, hair, m(8, 13), 6, 13, 5);
        px(ctx, hair, m(5, 4), 4, 4, 5); // bun at back
        px(ctx, hi, m(6, 2), 5, 2, 2);
        px(ctx, hair, m(8, 3), 9, 3, 4);
        break;
      case 'long':
        px(ctx, hair, m(7, 14), 5, 14, 7);
        px(ctx, hair, m(5, 5), 10, 5, 18); // flows down back
        px(ctx, hi, m(6, 1), 12, 1, 12);
        break;
      case 'short':
        px(ctx, hair, m(8, 13), 6, 13, 5);
        px(ctx, hair, m(8, 3), 5, 3, 2);
        px(ctx, hair, m(7, 3), 9, 3, 3);
        break;
      case 'bob':
        px(ctx, hair, m(7, 14), 5, 14, 8);
        px(ctx, hair, m(6, 4), 11, 4, 8);
        px(ctx, hi, m(8, 6), 6, 6, 1);
        break;
      case 'beanie': {
        const cap = t.hatColor ?? '#46607a';
        px(ctx, cap, m(7, 15), 4, 15, 7);
        px(ctx, lighten(cap, 26), m(8, 12), 4, 12, 2);
        px(ctx, darken(cap, 0.68), m(7, 15), 10, 15, 2);
        break;
      }
      default:
        px(ctx, hair, m(8, 13), 6, 13, 6);
    }
  }

  private drawAccSide(ctx: CanvasRenderingContext2D, t: CharStyle, hair: string, m: (x: number, w: number) => number): void {
    switch (t.acc) {
      case 'glasses':
      case 'bigglasses':
        px(ctx, '#2a2f3a', m(16, 6), 14, 6, 3);
        px(ctx, '#bfe9ff', m(17, 3), 15, 3, 1);
        break;
      case 'headphones':
        px(ctx, '#242424', m(8, 12), 6, 12, 2);
        px(ctx, '#242424', m(7, 4), 8, 4, 8);
        px(ctx, '#ff5d8f', m(7, 1), 10, 1, 4);
        break;
      case 'beard':
        px(ctx, hair, m(15, 7), 18, 7, 4);
        px(ctx, hair, m(20, 2), 15, 2, 4);
        break;
      case 'goggles':
        px(ctx, '#4a3320', m(8, 13), 6, 13, 2);
        px(ctx, '#7a5230', m(16, 5), 4, 5, 3);
        px(ctx, '#9fe8ff', m(17, 3), 5, 3, 1);
        break;
      default:
        break;
    }
  }

  /* ---- Back-facing head (hair + headwear only) ---- */
  private drawHeadUp(ctx: CanvasRenderingContext2D, t: CharStyle, hair: string, skin: string): void {
    px(ctx, skin, 12, 16, 8, 3); // nape
    px(ctx, hair, 9, 6, 14, 12);
    const hi = lighten(hair, 24);
    switch (t.hair) {
      case 'bun':
        px(ctx, hair, 13, 3, 6, 5);
        px(ctx, hi, 14, 4, 2, 2);
        break;
      case 'long':
        px(ctx, hair, 8, 8, 3, 19);
        px(ctx, hair, 21, 8, 3, 19);
        px(ctx, hair, 9, 6, 14, 18);
        break;
      case 'bob':
        px(ctx, hair, 8, 7, 16, 12);
        break;
      case 'beanie': {
        const cap = t.hatColor ?? '#46607a';
        px(ctx, cap, 8, 4, 16, 9);
        px(ctx, darken(cap, 0.68), 8, 11, 16, 2);
        break;
      }
      default:
        px(ctx, hi, 11, 7, 10, 1);
    }
    if (t.acc === 'headphones') {
      px(ctx, '#242424', 7, 8, 3, 8);
      px(ctx, '#242424', 22, 8, 3, 8);
      px(ctx, '#242424', 8, 6, 16, 2);
    }
    if (t.acc === 'goggles') {
      px(ctx, '#4a3320', 8, 6, 16, 2);
    }
  }

  private drawRoleMark(ctx: CanvasRenderingContext2D, agent: Agent, facing: Facing): void {
    const rightSide = facing !== 'left';
    const x = rightSide ? 22 : 5;
    switch (agent.roleKey) {
      case 'pm':
        // Clipboard held at the side (crown removed — bun + tie already lead).
        px(ctx, '#e7e0cf', x, 20, 6, 8);
        px(ctx, '#b7ad95', x + 1, 19, 4, 2);
        px(ctx, '#6b7280', x + 1, 22, 4, 1);
        px(ctx, '#6b7280', x + 1, 24, 4, 1);
        break;
      case 'ux':
        px(ctx, '#f9a8d4', x, 20, 5, 7);
        px(ctx, '#fff1f2', x + 1, 21, 3, 3);
        break;
      case 'frontend':
        px(ctx, '#67e8f9', x, 20, 6, 5);
        px(ctx, '#164e63', x + 1, 21, 4, 2);
        break;
      case 'backend':
        px(ctx, '#fbbf24', x, 20, 5, 8);
        px(ctx, '#92400e', x + 1, 22, 3, 1);
        px(ctx, '#92400e', x + 1, 25, 3, 1);
        break;
      case 'qa':
        px(ctx, '#86efac', x, 20, 6, 6);
        px(ctx, '#166534', x + 2, 18, 2, 10);
        px(ctx, '#166534', x, 22, 6, 2);
        break;
      case 'devops':
        px(ctx, '#c4b5fd', x, 20, 6, 6);
        px(ctx, '#5b21b6', x + 1, 21, 4, 1);
        px(ctx, '#5b21b6', x + 1, 24, 4, 1);
        break;
      default:
        break;
    }
  }

  private drawFlower(ctx: CanvasRenderingContext2D, x: number, y: number, color: string): void {
    px(ctx, '#2f7a3d', x + 2, y + 5, 2, 7);
    px(ctx, color, x, y, 3, 3);
    px(ctx, color, x + 4, y, 3, 3);
    px(ctx, color, x + 2, y + 3, 3, 3);
    px(ctx, '#fff8b5', x + 3, y + 2, 1, 1);
  }

  private addTexture(
    key: string,
    width: number,
    height: number,
    draw: (ctx: CanvasRenderingContext2D) => void,
  ): void {
    if (this.textures.exists(key)) return;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;
    draw(ctx);
    this.textures.addCanvas(key, canvas);
  }

  private createLoop(key: string, frames: string[], frameRate: number): void {
    if (this.anims.exists(key)) return;
    this.anims.create({
      key,
      frames: frames.map((frame) => ({ key: frame })),
      frameRate,
      repeat: -1,
    });
  }
}

export function PhaserPixelWorld({
  agents,
  theme,
  selectedId,
  onSelect,
  onDeselect,
}: PhaserPixelWorldProps): React.ReactElement {
  const hostRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<PixelTownScene | null>(null);
  const gameRef = useRef<Phaser.Game | null>(null);

  useEffect(() => {
    if (!hostRef.current || gameRef.current) return undefined;

    const scene = new PixelTownScene();
    sceneRef.current = scene;
    const game = new Phaser.Game({
      type: Phaser.AUTO,
      parent: hostRef.current,
      width: WORLD_W,
      height: WORLD_H,
      backgroundColor: '#2a3f28',
      pixelArt: true,
      roundPixels: true,
      audio: { noAudio: true },
      scale: {
        mode: Phaser.Scale.FIT,
        autoCenter: Phaser.Scale.CENTER_BOTH,
      },
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
