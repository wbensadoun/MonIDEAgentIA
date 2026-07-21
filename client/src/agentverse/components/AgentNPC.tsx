import React from 'react';
import type { Agent, ThemeMeta } from '../types';
import { AgentAvatar } from './AgentAvatar';
import { SpeechBubble } from './SpeechBubble';

interface AgentNPCProps {
  agent: Agent;
  theme: ThemeMeta;
  cellW: number;
  cellH: number;
  selected: boolean;
  onSelect: (id: string) => void;
}

const STATUS_LABEL: Record<Agent['status'], string> = {
  idle: 'Disponible',
  walking: 'En déplacement',
  working: 'Au travail',
  talking: 'En discussion',
  blocked: 'Bloqué',
};

/**
 * A single agent placed in the world. Owns its on-screen position (derived from
 * grid coords) and the CSS transition that animates movement. Theme-specific
 * look is handled in CSS via the world root class.
 */
function AgentNPCBase({ agent, theme, cellW, cellH, selected, onSelect }: AgentNPCProps) {
  const left = (agent.pos.x + 0.5) * cellW;
  const top = (agent.pos.y + 0.5) * cellH;
  const avatarSize = Math.max(34, Math.min(56, cellW * 0.92));

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onSelect(agent.id);
    }
  };

  return (
    <div
      className={[
        'av-npc',
        `av-npc--${agent.status}`,
        `av-npc--${agent.roleKey}`,
        selected ? 'is-selected' : '',
      ].join(' ').trim()}
      style={{ left, top, zIndex: 10 + Math.round(agent.pos.y) }}
      onClick={() => onSelect(agent.id)}
      onKeyDown={handleKey}
      role="button"
      tabIndex={0}
      aria-label={`${agent.name} — ${agent.role} (${STATUS_LABEL[agent.status]})`}
      title={`${agent.name} · ${agent.role}`}
    >
      {agent.bubble && (
        <div className="av-npc__bubble">
          <SpeechBubble bubble={agent.bubble} />
        </div>
      )}

      <div className="av-npc__sprite" style={{ '--accent': agent.accent } as React.CSSProperties}>
        <span className="av-npc__shadow" aria-hidden />
        {theme.id === 'campus' && (
          <span className="av-npc__gear" aria-hidden>
            <span className="av-npc__sword" />
            <span className="av-npc__shield" />
          </span>
        )}
        <AgentAvatar palette={agent.palette} facing={agent.facing} pixel={theme.pixel} roleKey={agent.roleKey} size={avatarSize} />
        {agent.status === 'working' && (
          agent.progress < 0 ? (
            // Indeterminate: real backend still working (#1) — no fake percentage.
            <span className="av-npc__work av-npc__work--indet" aria-hidden>
              <span className="av-npc__work-fill" />
            </span>
          ) : (
            <span className="av-npc__work" aria-hidden>
              <span className="av-npc__work-fill" style={{ width: `${Math.round(agent.progress * 100)}%` }} />
            </span>
          )
        )}
      </div>

      <div className="av-npc__tag">
        <span className="av-npc__name">{agent.name}</span>
        <span className="av-npc__role">{agent.role}</span>
      </div>
    </div>
  );
}

export const AgentNPC = React.memo(AgentNPCBase);
