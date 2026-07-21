import React, { useEffect, useRef, useState } from 'react';
import type { Agent, AgentRoleKey } from '../types';
import { AgentAvatar } from './AgentAvatar';

interface DialoguePanelProps {
  agent: Agent | null;
  pixel: boolean;
  onSend: (prompt: string) => void;
  onClose: () => void;
}

const QUICK_PROMPTS: Record<AgentRoleKey, string[]> = {
  pm: ['Découpe cette feature en tâches', "Rédige les critères d'acceptation"],
  ux: ['Propose un parcours plus simple', "Revois l'écran d'onboarding"],
  frontend: ['Ajoute un bouton "Partager cette recette"', 'Crée le composant carte recette'],
  backend: ["Crée l'endpoint de partage", "Sécurise l'authentification"],
  qa: ['Écris les tests du partage', 'Liste les cas limites'],
  devops: ['Configure la CI de preview', 'Prépare un plan de rollback'],
};

const STATUS_BADGE: Record<Agent['status'], string> = {
  idle: 'Disponible',
  walking: 'En déplacement',
  working: 'Au travail…',
  talking: 'À l’écoute',
  blocked: 'Bloqué',
};

/**
 * Bottom-docked dialogue box (RPG style). Holds the per-agent thread, a prompt
 * field and role-aware quick actions. Themeable via the root class.
 */
export function DialoguePanel({ agent, pixel, onSend, onClose }: DialoguePanelProps) {
  const [draft, setDraft] = useState('');
  const threadRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [agent?.chat.length, agent?.id, agent?.status]);

  if (!agent) return null;

  const submit = () => {
    const text = draft.trim();
    if (!text) return;
    onSend(text);
    setDraft('');
  };

  const working = agent.status === 'working';

  return (
    <div
      className={`av-dialogue${pixel ? ' av-dialogue--pixel' : ''}`}
      role="dialog"
      aria-label={`Discussion avec ${agent.name}`}
    >
      <header className="av-dialogue__head">
        <span className="av-dialogue__avatar" style={{ '--accent': agent.accent } as React.CSSProperties}>
          <AgentAvatar palette={agent.palette} facing="down" pixel={pixel} roleKey={agent.roleKey} size={40} />
        </span>
        <span className="av-dialogue__id">
          <strong>{agent.name}</strong>
          <small>{agent.role}</small>
        </span>
        {agent.roleKey === 'pm' && (
          <span className="av-dialogue__team" title="En tant que PM, Aria planifie puis délègue à l'équipe">
            🧭 Mode équipe
          </span>
        )}
        <span className={`av-dialogue__status av-dialogue__status--${agent.status}`}>
          {STATUS_BADGE[agent.status]}
        </span>
        <button type="button" className="av-dialogue__close" onClick={onClose} aria-label="Fermer">
          ✕
        </button>
      </header>

      <div className="av-dialogue__thread" ref={threadRef}>
        {agent.chat.length === 0 && (
          <p className="av-dialogue__empty">
            {agent.roleKey === 'pm' ? (
              <>Donne un objectif à <strong>{agent.name}</strong> : elle le cadre, puis délègue automatiquement aux bons agents de l&apos;équipe.</>
            ) : (
              <>Donne une instruction à <strong>{agent.name}</strong>. {agent.blurb}</>
            )}
          </p>
        )}
        {agent.chat.map((m) => (
          <div key={m.id} className={`av-msg av-msg--${m.from}`}>
            {m.text}
          </div>
        ))}
        {working && (
          <div className="av-msg av-msg--typing" aria-live="polite">
            <span className="av-dot" /><span className="av-dot" /><span className="av-dot" />
          </div>
        )}
      </div>

      <div className="av-dialogue__quick">
        {QUICK_PROMPTS[agent.roleKey].map((q) => (
          <button key={q} type="button" className="av-chip" onClick={() => onSend(q)} disabled={working}>
            {q}
          </button>
        ))}
      </div>

      <div className="av-dialogue__compose">
        <textarea
          className="av-dialogue__input"
          placeholder={working ? `${agent.name} travaille…` : `Parler à ${agent.name}…`}
          value={draft}
          rows={1}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
        />
        <button type="button" className="av-dialogue__send" onClick={submit} disabled={!draft.trim()}>
          Envoyer
        </button>
      </div>
    </div>
  );
}
