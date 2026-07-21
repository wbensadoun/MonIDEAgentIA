import React from 'react';
import type { Agent } from '../types';
import { AgentAvatar } from './AgentAvatar';

interface AgentStatusPanelProps {
  agents: Agent[];
  tasksByAgent: Record<string, string | undefined>;
  selectedId: string | null;
  nearbyIds: Set<string>;
  pixel: boolean;
  onSelect: (id: string) => void;
}

const STATUS_LABEL: Record<Agent['status'], string> = {
  idle: 'Disponible',
  walking: 'En déplacement',
  working: 'Au travail',
  talking: 'En discussion',
  blocked: 'Bloqué',
};

/** Team roster with live status; click a row to open the dialogue. */
export function AgentStatusPanel({ agents, tasksByAgent, selectedId, nearbyIds, pixel, onSelect }: AgentStatusPanelProps) {
  return (
    <div className="av-roster">
      {agents.map((a) => {
        const nearby = nearbyIds.has(a.id);
        return (
          <button
            key={a.id}
            type="button"
            className={[
              'av-roster__row',
              selectedId === a.id ? 'is-selected' : '',
              nearby ? 'is-nearby' : '',
            ].join(' ').trim()}
            style={{ '--accent': a.accent } as React.CSSProperties}
            onClick={() => onSelect(a.id)}
          >
            <span className="av-roster__avatar">
              <AgentAvatar palette={a.palette} facing="down" pixel={pixel} roleKey={a.roleKey} size={34} />
            </span>
            <span className="av-roster__body">
              <span className="av-roster__top">
                <strong>{a.name}</strong>
                <span className="av-roster__role">{a.role}</span>
                {nearby && <span className="av-roster__nearby">A portee</span>}
              </span>
              <span className="av-roster__sub">
                {a.status === 'working' && tasksByAgent[a.id]
                  ? tasksByAgent[a.id]
                  : STATUS_LABEL[a.status]}
              </span>
            </span>
            <span className={`av-roster__state av-roster__state--${a.status}`}>
              {a.status === 'working' && (a.progress < 0 ? '...' : `${Math.round(a.progress * 100)}%`)}
              <i className="av-roster__pip" />
            </span>
          </button>
        );
      })}
    </div>
  );
}
