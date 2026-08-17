/**
 * AutonomyControls
 * ------------------------------------------------------------------------
 * New component. Surfaces the two orthogonal axes that already exist in
 * the codebase but were never given a unified, visible control:
 *
 *   1. Execution Mode  — WHAT the agent is allowed to do
 *      (client/src/utils/agentModes.js: EXECUTION_MODES — ask/plan/agent/multi-agent)
 *   2. Autonomy Level  — HOW MUCH confirmation is required before it acts
 *      (client/src/stores/settingsStore.ts: PermissionMode — restricted/normal/permissive)
 *
 * Pre-existing inconsistency this component resolves at the UI layer:
 * AIChat/index.js (client/src/components/AIChat/index.js:280) reads a
 * `permissionMode` prop defaulting to 'edit_terminal' and compares it
 * against 'read_only', while settingsStore.ts defines the type as
 * 'restricted' | 'normal' | 'permissive' and defaults to 'restricted'.
 * These never match, so `canApplyPending` (index.js:568) silently
 * evaluates truthy more often than the store's own default intends.
 * AutonomyControls treats settingsStore's PermissionMode as the single
 * source of truth and exposes an adapter (`toLegacyPermission`) so
 * call sites still expecting the old strings keep working during
 * migration. See decisions[] in the design-system report.
 *
 * Placement: top of the chat column, above MessageViewer, per the
 * mandated hierarchy Autonomy Controls → Chat Area → Input.
 * ------------------------------------------------------------------------
 */
import React, { useCallback, useId, useMemo, useRef } from 'react';
import './AutonomyControls.css';

export type ExecutionModeId = 'ask' | 'plan' | 'agent';
export type AutonomyLevel = 'restricted' | 'normal' | 'permissive';

export interface ExecutionModeOption {
  id: ExecutionModeId;
  label: string;
  icon: string;
  description: string;
}

/** Persona custom, telle que fournie par le hook agents de App.js et
 *  consommée par AgentModePill (index.js:215). Seuls `name`/`description`/
 *  `scope` sont lus ici ; l'objet est renvoyé tel quel au parent. */
export interface AgentPersona {
  name: string;
  description?: string;
  scope?: string;
}

export interface AutonomyControlsProps {
  /** Current execution mode. Mirrors EXECUTION_MODES ids from agentModes.js. */
  executionMode: ExecutionModeId;
  onExecutionModeChange: (mode: ExecutionModeId) => void;
  /** Current autonomy level. Mirrors PermissionMode from settingsStore.ts. */
  autonomyLevel: AutonomyLevel;
  onAutonomyLevelChange: (level: AutonomyLevel) => void;
  /** Disables all controls while a run is in flight (isLoading upstream). */
  disabled?: boolean;
  /** Optional override of the execution-mode option list; defaults to the
   *  canonical four modes so this stays in sync with agentModes.js without
   *  importing a .js file into a strict .tsx (kept prop-driven by design —
   *  see decisions[] on JS/TS boundary). */
  executionModes?: ExecutionModeOption[];
  /** Personas custom disponibles. Vide/absent ⇒ la rangée « Agent » n'est pas
   *  rendue du tout (pas de contrôle vide affiché à l'utilisateur). */
  agents?: AgentPersona[];
  /** Persona actuellement active, ou null pour « Aucun » (mode seul). */
  activeAgent?: AgentPersona | null;
  onActiveAgentChange?: (agent: AgentPersona | null) => void;
  /** Ouvre le gestionnaire d'agents. Absent ⇒ bouton non rendu. */
  onOpenAgentManager?: () => void;
  className?: string;
}

export const DEFAULT_MODES: ExecutionModeOption[] = [
  { id: 'ask', label: 'Ask', icon: '💬', description: 'Lecture et recherche. Aucune écriture.' },
  { id: 'plan', label: 'Plan', icon: '📋', description: 'Explore et propose un plan validable.' },
  { id: 'agent', label: 'Agent', icon: '🔧', description: 'Diff, permissions et rollback.' }
];

// 'restricted' ("Lecture seule") a été retiré de cette liste : le niveau
// d'autonomie n'est affiché qu'en mode Agent (voir index.js:1348, exécution
// conditionnelle de AutonomyPill), et Agent propose toujours des écritures
// (diff/terminal) — "Lecture seule" y est une contradiction logique. Ce
// besoin est déjà couvert par le mode Ask (lecture seule par construction,
// cf. DEFAULT_MODES ci-dessus), pas par un niveau d'autonomie en plus.
export const AUTONOMY_LEVELS: Array<{
  id: AutonomyLevel;
  label: string;
  helper: string;
  tone: 'success' | 'warning' | 'danger';
}> = [
  { id: 'normal', label: 'Supervisé', helper: 'Diff proposé, application après confirmation.', tone: 'warning' },
  { id: 'permissive', label: 'Autonome', helper: 'Applique et exécute le terminal sans confirmation.', tone: 'danger' }
];

/** Adapter for legacy call sites still reading the pre-refactor strings. */
export function toLegacyPermission(level: AutonomyLevel): 'read_only' | 'edit_only' | 'edit_terminal' {
  if (level === 'restricted') return 'read_only';
  if (level === 'normal') return 'edit_only';
  return 'edit_terminal';
}

export const AutonomyControls: React.FC<AutonomyControlsProps> = ({
  executionMode,
  onExecutionModeChange,
  autonomyLevel,
  onAutonomyLevelChange,
  disabled = false,
  executionModes = DEFAULT_MODES,
  agents,
  activeAgent = null,
  onActiveAgentChange,
  onOpenAgentManager,
  className
}) => {
  const groupId = useId();
  const buttonRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  const activeLevel = useMemo(
    () => AUTONOMY_LEVELS.find((level) => level.id === autonomyLevel) ?? AUTONOMY_LEVELS[0],
    [autonomyLevel]
  );

  const agentOptions = useMemo(() => (Array.isArray(agents) ? agents : []), [agents]);

  // Sémantique reprise telle quelle de AgentModePill (index.js:225-238), pour
  // que les deux surfaces ne divergent pas pendant la migration :
  //  - choisir un mode désélectionne la persona active ;
  //  - choisir une persona force le mode 'agent' (une persona écrit du code,
  //    elle n'a pas de sens sous Ask/Plan).
  const selectMode = useCallback(
    (modeId: ExecutionModeId) => {
      onExecutionModeChange(modeId);
      if (activeAgent && onActiveAgentChange) onActiveAgentChange(null);
    },
    [onExecutionModeChange, activeAgent, onActiveAgentChange]
  );

  const selectAgent = useCallback(
    (agent: AgentPersona | null) => {
      if (onActiveAgentChange) onActiveAgentChange(agent);
      if (agent && executionMode !== 'agent') onExecutionModeChange('agent');
    },
    [onActiveAgentChange, onExecutionModeChange, executionMode]
  );

  const handleModeKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>, ids: string[], currentId: string, onSelect: (id: string) => void) => {
      const currentIndex = ids.indexOf(currentId);
      let nextId: string | null = null;

      if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
        event.preventDefault();
        nextId = ids[(currentIndex + 1) % ids.length];
      } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
        event.preventDefault();
        nextId = ids[(currentIndex - 1 + ids.length) % ids.length];
      } else if (event.key === 'Home') {
        event.preventDefault();
        nextId = ids[0];
      } else if (event.key === 'End') {
        event.preventDefault();
        nextId = ids[ids.length - 1];
      }

      if (nextId) {
        onSelect(nextId);
        // Focus the new button after state updates
        setTimeout(() => {
          const button = buttonRefs.current[nextId];
          if (button) button.focus();
        }, 0);
      }
    },
    []
  );

  return (
    <section
      className={['autonomy-controls', className].filter(Boolean).join(' ')}
      aria-label="Contrôles d'autonomie de l'agent"
    >
      <div className="autonomy-controls__row">
        <span className="autonomy-controls__eyebrow" id={`${groupId}-mode-label`}>
          Mode d&apos;exécution
        </span>
        <div
          className="autonomy-controls__segmented"
          role="radiogroup"
          aria-labelledby={`${groupId}-mode-label`}
          onKeyDown={(event) =>
            handleModeKeyDown(
              event,
              executionModes.map((m) => m.id),
              executionMode,
              (id) => selectMode(id as ExecutionModeId)
            )
          }
        >
          {executionModes.map((mode) => {
            // Une persona active « emprunte » le mode agent : aucun segment de
            // mode n'est alors coché, sinon l'utilisateur verrait deux
            // contrôles se revendiquer actifs en même temps.
            const isActive = mode.id === executionMode && !activeAgent;
            return (
              <button
                key={mode.id}
                ref={(el) => {
                  if (el) buttonRefs.current[mode.id] = el;
                }}
                type="button"
                role="radio"
                aria-checked={isActive}
                data-focus-ring
                // Roving tabindex sur le mode courant même quand une persona
                // est active : sinon plus aucun segment n'est atteignable au
                // clavier dans cette rangée.
                tabIndex={mode.id === executionMode ? 0 : -1}
                className={`autonomy-controls__segment${isActive ? ' is-active' : ''}`}
                disabled={disabled}
                title={mode.description}
                onClick={() => selectMode(mode.id)}
              >
                <span className="autonomy-controls__segment-icon" aria-hidden="true">
                  {mode.icon}
                </span>
                {mode.label}
              </button>
            );
          })}
        </div>
      </div>

      {agentOptions.length > 0 && (
        <div className="autonomy-controls__row">
          <span className="autonomy-controls__eyebrow" id={`${groupId}-agent-label`}>
            Agent
          </span>
          <div
            className="autonomy-controls__segmented"
            role="radiogroup"
            aria-labelledby={`${groupId}-agent-label`}
            onKeyDown={(event) =>
              handleModeKeyDown(
                event,
                ['none', ...agentOptions.map((a) => `agent:${a.name}`)],
                activeAgent ? `agent:${activeAgent.name}` : 'none',
                (id) =>
                  selectAgent(
                    id === 'none' ? null : agentOptions.find((a) => `agent:${a.name}` === id) ?? null
                  )
              )
            }
          >
            <button
              ref={(el) => {
                if (el) buttonRefs.current.none = el;
              }}
              type="button"
              role="radio"
              aria-checked={!activeAgent}
              data-focus-ring
              tabIndex={!activeAgent ? 0 : -1}
              className={`autonomy-controls__segment${!activeAgent ? ' is-active' : ''}`}
              disabled={disabled}
              title="Utiliser le mode d'exécution seul, sans persona."
              onClick={() => selectAgent(null)}
            >
              Aucun
            </button>
            {agentOptions.map((agent) => {
              const isActive = activeAgent?.name === agent.name;
              return (
                <button
                  // Les personas peuvent partager un nom entre scopes : la clé
                  // inclut le scope, comme dans AgentModePill (index.js:279).
                  key={`${agent.scope || ''}:${agent.name}`}
                  ref={(el) => {
                    if (el) buttonRefs.current[`agent:${agent.name}`] = el;
                  }}
                  type="button"
                  role="radio"
                  aria-checked={isActive}
                  data-focus-ring
                  tabIndex={isActive ? 0 : -1}
                  className={`autonomy-controls__segment${isActive ? ' is-active' : ''}`}
                  disabled={disabled}
                  title={agent.description}
                  onClick={() => selectAgent(agent)}
                >
                  <span className="autonomy-controls__segment-icon" aria-hidden="true">
                    👤
                  </span>
                  {agent.name}
                </button>
              );
            })}
          </div>
          {onOpenAgentManager && (
            <button
              type="button"
              className="autonomy-controls__manage"
              data-focus-ring
              disabled={disabled}
              onClick={onOpenAgentManager}
            >
              Gérer les agents
            </button>
          )}
        </div>
      )}

      <div className="autonomy-controls__row">
        <span className="autonomy-controls__eyebrow" id={`${groupId}-level-label`}>
          Niveau d&apos;autonomie
        </span>
        <div
          className="autonomy-controls__segmented"
          role="radiogroup"
          aria-labelledby={`${groupId}-level-label`}
          onKeyDown={(event) =>
            handleModeKeyDown(
              event,
              AUTONOMY_LEVELS.map((l) => l.id),
              autonomyLevel,
              (id) => onAutonomyLevelChange(id as AutonomyLevel)
            )
          }
        >
          {AUTONOMY_LEVELS.map((level) => {
            const isActive = level.id === autonomyLevel;
            return (
              <button
                key={level.id}
                ref={(el) => {
                  if (el) buttonRefs.current[level.id] = el;
                }}
                type="button"
                role="radio"
                aria-checked={isActive}
                data-focus-ring
                tabIndex={isActive ? 0 : -1}
                className={`autonomy-controls__segment autonomy-controls__segment--${level.tone}${isActive ? ' is-active' : ''}`}
                disabled={disabled}
                onClick={() => onAutonomyLevelChange(level.id)}
              >
                <span className={`autonomy-controls__dot autonomy-controls__dot--${level.tone}`} aria-hidden="true" />
                {level.label}
              </button>
            );
          })}
        </div>
        <p className="autonomy-controls__helper" role="status">
          {activeLevel.helper}
        </p>
      </div>
    </section>
  );
};

export default AutonomyControls;
