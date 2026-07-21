import React, { useMemo } from 'react';
import type { Agent, Task, TaskStatus } from '../types';

interface TaskBoardProps {
  tasks: Task[];
  agents: Agent[];
  onSelectAgent: (id: string) => void;
  /**
   * Optional bridge to the host (#3): when provided, "Done" tasks show a
   * "Voir les changements" action. The module stays autonomous without it.
   */
  onViewChanges?: (task: Task) => void;
}

const COLUMNS: Array<{ id: TaskStatus; label: string }> = [
  { id: 'todo', label: 'À faire' },
  { id: 'in_progress', label: 'En cours' },
  { id: 'done', label: 'Terminé' },
];

const TAG_LABEL: Record<Task['tag'], string> = {
  feature: 'Feature',
  bug: 'Bug',
  chore: 'Chore',
  design: 'Design',
};

/** Shared Kanban board (Todo / In Progress / Done) — compact for the side rail. */
export function TaskBoard({ tasks, agents, onSelectAgent, onViewChanges }: TaskBoardProps) {
  const byId = useMemo(() => {
    const map = new Map<string, Agent>();
    agents.forEach((a) => map.set(a.id, a));
    return map;
  }, [agents]);

  return (
    <div className="av-board">
      {COLUMNS.map((col) => {
        const items = tasks.filter((t) => t.status === col.id);
        return (
          <section key={col.id} className={`av-board__col av-board__col--${col.id}`}>
            <header className="av-board__head">
              <span>{col.label}</span>
              <span className="av-board__count">{items.length}</span>
            </header>
            <div className="av-board__list">
              {items.length === 0 && <p className="av-board__empty">—</p>}
              {items.map((t) => {
                const owner = t.assigneeId ? byId.get(t.assigneeId) : undefined;
                return (
                  <article key={t.id} className="av-task">
                    <p className="av-task__title">{t.title}</p>
                    <div className="av-task__meta">
                      <span className={`av-tag av-tag--${t.tag}`}>{TAG_LABEL[t.tag]}</span>
                      {owner && (
                        <button
                          type="button"
                          className="av-task__owner"
                          style={{ '--accent': owner.accent } as React.CSSProperties}
                          onClick={() => onSelectAgent(owner.id)}
                          title={`${owner.name} · ${owner.role}`}
                        >
                          <span className="av-task__dot" />
                          {owner.name}
                        </button>
                      )}
                    </div>
                    {col.id === 'done' && onViewChanges && (
                      <button
                        type="button"
                        className="av-task__changes"
                        onClick={() => onViewChanges(t)}
                        title="Ouvrir les changements liés dans l'IDE"
                      >
                        Voir les changements →
                      </button>
                    )}
                  </article>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
