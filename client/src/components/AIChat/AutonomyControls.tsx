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
  className?: string;
}

export const DEFAULT_MODES: ExecutionModeOption[] = [
  { id: 'ask', label: 'Ask', icon: '💬', description: 'Lecture et recherche. Aucune écriture.' },
  { id: 'plan', label: 'Plan', icon: '📋', description: 'Explore et propose un plan validable.' },
  { id: 'agent', label: 'Agent', icon: '🔧', description: 'Diff, permissions et rollback.' }
];

export const AUTONOMY_LEVELS: Array<{
  id: AutonomyLevel;
  label: string;
  helper: string;
  tone: 'success' | 'warning' | 'danger';
}> = [
  { id: 'restricted', label: 'Lecture seule', helper: 'Aucune modification appliquée sans revue manuelle.', tone: 'success' },
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
  className
}) => {
  const groupId = useId();
  const buttonRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  const activeLevel = useMemo(
    () => AUTONOMY_LEVELS.find((level) => level.id === autonomyLevel) ?? AUTONOMY_LEVELS[0],
    [autonomyLevel]
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
              (id) => onExecutionModeChange(id as ExecutionModeId)
            )
          }
        >
          {executionModes.map((mode) => {
            const isActive = mode.id === executionMode;
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
                tabIndex={isActive ? 0 : -1}
                className={`autonomy-controls__segment${isActive ? ' is-active' : ''}`}
                disabled={disabled}
                title={mode.description}
                onClick={() => onExecutionModeChange(mode.id)}
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
