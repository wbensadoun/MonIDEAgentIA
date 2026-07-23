import React, { useLayoutEffect, useRef, useState } from 'react';
import type { Agent, ThemeMeta } from '../types';
import { AgentNPC } from './AgentNPC';
import { PhaserTownWorld } from './PhaserTownWorld';
import { PhaserTamersWorld } from './PhaserTamersWorld';

interface GameWorldProps {
  agents: Agent[];
  theme: ThemeMeta;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onDeselect: () => void;
}

type RoomKind = 'standup' | 'focus' | 'design' | 'code' | 'qa' | 'ops';

interface WorldRect {
  id: string;
  label: string;
  kind: RoomKind;
  x: number;
  y: number;
  w: number;
  h: number;
}

interface WorldObject {
  id: string;
  type:
    | 'table'
    | 'rug'
    | 'board'
    | 'plant'
    | 'screen'
    | 'sofa'
    | 'guild-table'
    | 'quest-board'
    | 'barrel'
    | 'tavern-table'
    | 'bookshelf'
    | 'forge'
    | 'anvil'
    | 'weapon-rack'
    | 'portal'
    | 'crystal'
    | 'training-dummy'
    | 'chest'
    | 'torch'
    | 'banner'
    | 'statue'
    | 'road'
    | 'palm'
    | 'arcade'
    | 'cassette'
    | 'neon-sign'
    | 'sports-car'
    | 'speaker'
    | 'equalizer'
    | 'holo-ring'
    | 'tower'
    | 'wire-pyramid'
    | 'cottage'
    | 'lab'
    | 'market-stall'
    | 'signpost'
    | 'tree'
    | 'flower-patch'
    | 'pond'
    | 'fence'
    | 'bridge'
    | 'boulder'
    | 'creature-den'
    | 'server-stack'
    | 'holo-table'
    | 'neon-tube'
    | 'vending'
    | 'drone'
    | 'data-rack'
    | 'terminal'
    | 'cable'
    | 'holo-ad'
    | 'city-tower'
    | 'scanner-gate';
  x: number;
  y: number;
  w: number;
  h: number;
}

const ROOMS: WorldRect[] = [
  { id: 'standup', label: 'Stand-up', kind: 'standup', x: 0.8, y: 0.7, w: 4.6, h: 3.0 },
  { id: 'focus', label: 'Focus', kind: 'focus', x: 5.9, y: 0.7, w: 4.1, h: 3.0 },
  { id: 'design', label: 'Design', kind: 'design', x: 10.5, y: 0.7, w: 4.7, h: 3.0 },
  { id: 'code', label: 'Code Lab', kind: 'code', x: 0.8, y: 5.8, w: 4.6, h: 3.4 },
  { id: 'qa', label: 'QA', kind: 'qa', x: 5.9, y: 5.8, w: 4.1, h: 3.4 },
  { id: 'ops', label: 'Ops', kind: 'ops', x: 10.5, y: 5.8, w: 4.7, h: 3.4 },
];

const OBJECTS: WorldObject[] = [
  { id: 'table-standup', type: 'table', x: 2.4, y: 2.2, w: 1.9, h: 0.65 },
  { id: 'rug-standup', type: 'rug', x: 2.0, y: 1.45, w: 2.7, h: 0.45 },
  { id: 'board-focus', type: 'board', x: 7.0, y: 1.2, w: 1.6, h: 0.5 },
  { id: 'sofa-focus', type: 'sofa', x: 7.25, y: 2.5, w: 1.9, h: 0.55 },
  { id: 'board-design', type: 'board', x: 11.6, y: 1.25, w: 1.9, h: 0.55 },
  { id: 'plant-design', type: 'plant', x: 14.25, y: 2.9, w: 0.45, h: 0.55 },
  { id: 'screen-code', type: 'screen', x: 2.15, y: 8.15, w: 2.15, h: 0.6 },
  { id: 'plant-code', type: 'plant', x: 4.4, y: 6.45, w: 0.45, h: 0.55 },
  { id: 'board-qa', type: 'board', x: 7.0, y: 6.45, w: 1.8, h: 0.55 },
  { id: 'rug-qa', type: 'rug', x: 6.85, y: 8.35, w: 2.0, h: 0.45 },
  { id: 'screen-ops', type: 'screen', x: 12.1, y: 6.45, w: 2.05, h: 0.6 },
  { id: 'table-ops', type: 'table', x: 12.3, y: 8.35, w: 2.35, h: 0.7 },
];

const TOWN_OBJECTS: WorldObject[] = [
  { id: 'town-lab', type: 'lab', x: 1.24, y: 1.06, w: 1.52, h: 1.14 },
  { id: 'town-sign', type: 'signpost', x: 4.06, y: 2.72, w: 0.56, h: 0.56 },
  { id: 'town-cottage-a', type: 'cottage', x: 6.38, y: 1.08, w: 1.36, h: 1.06 },
  { id: 'town-market', type: 'market-stall', x: 8.2, y: 2.52, w: 1.28, h: 0.68 },
  { id: 'town-tree-a', type: 'tree', x: 11.18, y: 0.9, w: 0.66, h: 1.0 },
  { id: 'town-tree-b', type: 'tree', x: 13.98, y: 2.58, w: 0.66, h: 1.0 },
  { id: 'town-flower-a', type: 'flower-patch', x: 12.18, y: 2.72, w: 1.08, h: 0.44 },
  { id: 'town-pond', type: 'pond', x: 1.34, y: 6.34, w: 1.82, h: 1.1 },
  { id: 'town-bridge', type: 'bridge', x: 2.26, y: 7.54, w: 1.18, h: 0.42 },
  { id: 'town-fence-a', type: 'fence', x: 3.65, y: 6.18, w: 1.16, h: 0.32 },
  { id: 'town-den', type: 'creature-den', x: 6.58, y: 6.45, w: 1.18, h: 0.92 },
  { id: 'town-boulder-a', type: 'boulder', x: 8.86, y: 8.12, w: 0.58, h: 0.46 },
  { id: 'town-flower-b', type: 'flower-patch', x: 6.55, y: 8.42, w: 1.4, h: 0.42 },
  { id: 'town-station', type: 'lab', x: 12.1, y: 6.42, w: 1.5, h: 1.14 },
  { id: 'town-fence-b', type: 'fence', x: 13.72, y: 8.65, w: 1.05, h: 0.32 },
  { id: 'town-tree-c', type: 'tree', x: 14.33, y: 6.22, w: 0.66, h: 1.0 },
];

const RPG_OBJECTS: WorldObject[] = [
  { id: 'guild-table', type: 'guild-table', x: 2.05, y: 1.85, w: 2.6, h: 0.85 },
  { id: 'guild-board', type: 'quest-board', x: 1.18, y: 1.02, w: 1.25, h: 0.62 },
  { id: 'guild-banner-a', type: 'banner', x: 4.55, y: 0.9, w: 0.45, h: 0.95 },
  { id: 'guild-chest', type: 'chest', x: 4.25, y: 2.86, w: 0.62, h: 0.44 },
  { id: 'tavern-table-a', type: 'tavern-table', x: 6.65, y: 1.48, w: 1.15, h: 0.72 },
  { id: 'tavern-table-b', type: 'tavern-table', x: 8.15, y: 2.52, w: 1.15, h: 0.72 },
  { id: 'tavern-barrel-a', type: 'barrel', x: 9.08, y: 1.0, w: 0.48, h: 0.62 },
  { id: 'tavern-barrel-b', type: 'barrel', x: 9.08, y: 1.62, w: 0.48, h: 0.62 },
  { id: 'tavern-books', type: 'bookshelf', x: 6.18, y: 2.82, w: 1.1, h: 0.48 },
  { id: 'forge-fire', type: 'forge', x: 11.35, y: 1.2, w: 1.0, h: 0.72 },
  { id: 'forge-anvil', type: 'anvil', x: 13.04, y: 2.08, w: 0.8, h: 0.48 },
  { id: 'forge-rack', type: 'weapon-rack', x: 14.0, y: 1.04, w: 0.72, h: 1.25 },
  { id: 'forge-torch', type: 'torch', x: 10.84, y: 2.86, w: 0.28, h: 0.65 },
  { id: 'dungeon-statue', type: 'statue', x: 1.38, y: 6.32, w: 0.72, h: 0.92 },
  { id: 'dungeon-crystal', type: 'crystal', x: 3.96, y: 6.38, w: 0.55, h: 0.86 },
  { id: 'dungeon-chest', type: 'chest', x: 2.22, y: 8.58, w: 0.72, h: 0.5 },
  { id: 'dungeon-torch', type: 'torch', x: 4.62, y: 8.12, w: 0.28, h: 0.65 },
  { id: 'arena-dummy-a', type: 'training-dummy', x: 6.56, y: 6.55, w: 0.5, h: 0.86 },
  { id: 'arena-dummy-b', type: 'training-dummy', x: 8.9, y: 8.26, w: 0.5, h: 0.86 },
  { id: 'arena-rack', type: 'weapon-rack', x: 8.8, y: 6.32, w: 0.72, h: 1.25 },
  { id: 'arena-banner', type: 'banner', x: 6.2, y: 8.64, w: 0.45, h: 0.92 },
  { id: 'portal-core', type: 'portal', x: 12.42, y: 6.55, w: 1.7, h: 1.7 },
  { id: 'portal-crystal-a', type: 'crystal', x: 11.14, y: 8.28, w: 0.5, h: 0.82 },
  { id: 'portal-crystal-b', type: 'crystal', x: 14.34, y: 8.28, w: 0.5, h: 0.82 },
  { id: 'portal-torch', type: 'torch', x: 14.62, y: 6.35, w: 0.28, h: 0.65 },
];

const SYNTHWAVE_OBJECTS: WorldObject[] = [
  { id: 'synth-road', type: 'road', x: 6.1, y: 4.65, w: 3.8, h: 4.9 },
  { id: 'synth-palm-l', type: 'palm', x: 1.05, y: 0.85, w: 0.58, h: 2.25 },
  { id: 'synth-palm-r', type: 'palm', x: 14.35, y: 0.85, w: 0.58, h: 2.25 },
  { id: 'synth-sign', type: 'neon-sign', x: 1.55, y: 1.2, w: 2.25, h: 0.68 },
  { id: 'synth-arcade-a', type: 'arcade', x: 6.45, y: 1.16, w: 0.82, h: 1.22 },
  { id: 'synth-arcade-b', type: 'arcade', x: 8.4, y: 1.16, w: 0.82, h: 1.22 },
  { id: 'synth-cassette', type: 'cassette', x: 11.62, y: 1.18, w: 1.9, h: 0.82 },
  { id: 'synth-speaker-a', type: 'speaker', x: 1.45, y: 6.42, w: 0.78, h: 1.12 },
  { id: 'synth-speaker-b', type: 'speaker', x: 4.15, y: 8.05, w: 0.78, h: 1.12 },
  { id: 'synth-pyramid', type: 'wire-pyramid', x: 3.0, y: 6.76, w: 1.34, h: 1.32 },
  { id: 'synth-eq', type: 'equalizer', x: 6.55, y: 6.35, w: 2.75, h: 0.78 },
  { id: 'synth-car', type: 'sports-car', x: 11.45, y: 6.35, w: 2.42, h: 0.98 },
  { id: 'synth-holo', type: 'holo-ring', x: 12.58, y: 8.12, w: 1.48, h: 0.96 },
  { id: 'synth-tower', type: 'tower', x: 14.3, y: 7.1, w: 0.66, h: 1.82 },
];

const CYBERPUNK_OBJECTS: WorldObject[] = [
  { id: 'cyber-hub-table', type: 'holo-table', x: 2.22, y: 1.65, w: 1.74, h: 0.92 },
  { id: 'cyber-hub-ad', type: 'holo-ad', x: 4.16, y: 0.98, w: 0.82, h: 1.28 },
  { id: 'cyber-hub-tube', type: 'neon-tube', x: 1.18, y: 2.92, w: 1.14, h: 0.2 },
  { id: 'cyber-rack-a', type: 'server-stack', x: 6.38, y: 1.08, w: 0.72, h: 1.48 },
  { id: 'cyber-rack-b', type: 'server-stack', x: 7.34, y: 1.08, w: 0.72, h: 1.48 },
  { id: 'cyber-vending', type: 'vending', x: 8.72, y: 1.42, w: 0.82, h: 1.18 },
  { id: 'cyber-drone-a', type: 'drone', x: 11.2, y: 1.16, w: 0.72, h: 0.44 },
  { id: 'cyber-terminal-a', type: 'terminal', x: 12.45, y: 2.38, w: 1.18, h: 0.72 },
  { id: 'cyber-ad-b', type: 'holo-ad', x: 14.35, y: 1.02, w: 0.62, h: 1.54 },
  { id: 'cyber-cable-a', type: 'cable', x: 1.42, y: 6.45, w: 2.64, h: 0.24 },
  { id: 'cyber-gate', type: 'scanner-gate', x: 3.84, y: 7.58, w: 0.88, h: 1.2 },
  { id: 'cyber-rack-c', type: 'data-rack', x: 6.34, y: 6.44, w: 0.88, h: 1.38 },
  { id: 'cyber-rack-d', type: 'data-rack', x: 8.54, y: 7.62, w: 0.88, h: 1.38 },
  { id: 'cyber-drone-b', type: 'drone', x: 7.72, y: 8.25, w: 0.72, h: 0.44 },
  { id: 'cyber-tower-a', type: 'city-tower', x: 11.08, y: 6.28, w: 0.74, h: 1.78 },
  { id: 'cyber-terminal-b', type: 'terminal', x: 12.32, y: 8.18, w: 1.18, h: 0.72 },
  { id: 'cyber-tower-b', type: 'city-tower', x: 14.25, y: 6.5, w: 0.74, h: 1.78 },
];

const TOWN_ROOM_LABEL: Record<RoomKind, string> = {
  standup: 'Village',
  focus: 'Lab IA',
  design: 'Route Nord',
  code: 'Atelier',
  qa: 'Prairie QA',
  ops: 'Station',
};

const CYBERPUNK_ROOM_LABEL: Record<RoomKind, string> = {
  standup: 'Netrun Hub',
  focus: 'Data Bar',
  design: 'Augment Lab',
  code: 'Back Alley',
  qa: 'Test Grid',
  ops: 'Sky Dock',
};

const RPG_ROOM_LABEL: Record<RoomKind, string> = {
  standup: 'Guilde',
  focus: 'Taverne',
  design: 'Forge UX',
  code: 'Donjon Code',
  qa: 'Arene QA',
  ops: 'Portail Ops',
};

const SYNTHWAVE_ROOM_LABEL: Record<RoomKind, string> = {
  standup: 'Neon Hub',
  focus: 'Arcade',
  design: 'Signal',
  code: 'Night Drive',
  qa: 'QA Scan',
  ops: 'Launch Pad',
};

function roomLabelFor(theme: ThemeMeta, room: WorldRect): string {
  if (theme.id === 'town') return TOWN_ROOM_LABEL[room.kind];
  if (theme.id === 'cyberpunk') return CYBERPUNK_ROOM_LABEL[room.kind];
  if (theme.id === 'campus') return RPG_ROOM_LABEL[room.kind];
  if (theme.id === 'synthwave') return SYNTHWAVE_ROOM_LABEL[room.kind];
  return room.label;
}

function rectStyle(rect: Pick<WorldRect | WorldObject, 'x' | 'y' | 'w' | 'h'>, cellW: number, cellH: number): React.CSSProperties {
  return {
    left: rect.x * cellW,
    top: rect.y * cellH,
    width: rect.w * cellW,
    height: rect.h * cellH,
  };
}

/**
 * The playfield. Measures itself, derives a uniform cell size from the theme
 * grid, paints theme decor (floor + desks + rooms) and lays out the agents.
 * All theme styling is CSS-driven via the `av-world--<theme>` class.
 */
export function GameWorld({ agents, theme, selectedId, onSelect, onDeselect }: GameWorldProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });

  // Measure on mount and theme change. Single measurement avoids ResizeObserver loop.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    setSize({ w: el.clientWidth, h: el.clientHeight });
  }, [theme.id]);

  const cellW = size.w > 0 ? size.w / theme.cols : 0;
  const cellH = size.h > 0 ? size.h / theme.rows : 0;
  const ready = cellW > 0 && cellH > 0;
  const selectedAgent = selectedId ? agents.find((a) => a.id === selectedId) : null;
  const objects = theme.id === 'town'
    ? TOWN_OBJECTS
    : theme.id === 'cyberpunk'
      ? CYBERPUNK_OBJECTS
      : theme.id === 'campus'
        ? RPG_OBJECTS
        : theme.id === 'synthwave'
          ? SYNTHWAVE_OBJECTS
          : OBJECTS;

  if (theme.id === 'town') {
    return (
      <PhaserTownWorld
        agents={agents}
        theme={theme}
        selectedId={selectedId}
        onSelect={onSelect}
        onDeselect={onDeselect}
      />
    );
  }

  if (theme.id === 'tamers') {
    return (
      <PhaserTamersWorld
        agents={agents}
        theme={theme}
        selectedId={selectedId}
        onSelect={onSelect}
        onDeselect={onDeselect}
      />
    );
  }

  return (
    <div
      ref={ref}
      className={`av-world av-world--${theme.id}`}
      onClick={(e) => {
        if (e.target === e.currentTarget) onDeselect();
      }}
    >
      <div className="av-world__floor" aria-hidden />
      <div className="av-world__decor" aria-hidden />

      {ready && (
        <>
          {ROOMS.map((room) => (
            <div
              key={room.id}
              className={`av-room av-room--${room.kind}`}
              style={rectStyle(room, cellW, cellH)}
              aria-hidden
            >
              <span className="av-room__label">{roomLabelFor(theme, room)}</span>
            </div>
          ))}

          {objects.map((object) => (
            <div
              key={object.id}
              className={`av-object av-object--${object.type}`}
              style={rectStyle(object, cellW, cellH)}
              aria-hidden
            />
          ))}

          {selectedAgent && (
            <div
              className="av-proximity"
              style={{
                left: (selectedAgent.pos.x + 0.5) * cellW,
                top: (selectedAgent.pos.y + 0.5) * cellH,
                width: cellW * 4.3,
                height: cellH * 3.2,
              }}
              aria-hidden
            />
          )}

          {/* Desks / stations: one per agent home so the team has anchors. */}
          {agents.map((a) => (
            <div
              key={`desk-${a.id}`}
              className="av-desk"
              aria-hidden
              style={{
                left: (a.home.x + 0.5) * cellW,
                top: (a.home.y + 0.85) * cellH,
                width: cellW * 1.4,
                height: cellH * 0.9,
                '--accent': a.accent,
                zIndex: 5 + Math.round(a.home.y),
              } as React.CSSProperties}
            >
              <span className="av-desk__screen" />
              <span className="av-desk__label">{a.role}</span>
            </div>
          ))}

          {agents.map((a) => (
            <AgentNPC
              key={a.id}
              agent={a}
              theme={theme}
              cellW={cellW}
              cellH={cellH}
              selected={selectedId === a.id}
              onSelect={onSelect}
            />
          ))}
        </>
      )}

      {!selectedId && <div className="av-world__hint">Clique sur un agent pour lui parler</div>}
    </div>
  );
}
