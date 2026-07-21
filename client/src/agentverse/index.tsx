import { useMemo, useState } from 'react';
import './AgentVerse.css';
import './themes.css';
import type { AgentClient, ThemeId } from './types';
import { DEFAULT_THEME, THEMES } from './data/themes';
import { createMockAgentClient } from './llm/agentClient';
import { createElectronAgentClient } from './llm/electronAgentClient';
import { hasElectronAI } from './llm/electronApi';
import { useAgentWorld } from './engine/useAgentWorld';
import { Topbar } from './components/Topbar';
import { GameWorld } from './components/GameWorld';
import { AgentStatusPanel } from './components/AgentStatusPanel';
import { TaskBoard } from './components/TaskBoard';
import { DialoguePanel } from './components/DialoguePanel';
import type { Task } from './types';

interface AgentVerseProps {
  /**
   * Inject a custom LLM-backed client. When omitted, AgentVerse auto-detects:
   * the IDE's Electron AI bridge if present, otherwise the local mock.
   */
  client?: AgentClient;
  /**
   * Optional host bridge (#3): called when the user clicks "Voir les
   * changements" on a Done task. The IDE wires this to open its AI Changes
   * view. Absent -> the action is hidden and the module stays standalone.
   */
  onViewChanges?: (task: Task) => void;
}

const THEME_KEY = 'agentverse_theme';

function readTheme(): ThemeId {
  try {
    const v = localStorage.getItem(THEME_KEY) as ThemeId | null;
    if (v && v in THEMES) return v;
  } catch {
    /* ignore */
  }
  return DEFAULT_THEME;
}

/**
 * Root of the multi-agent RPG interface. One engine, five sellable skins.
 * Self-contained (mock data) but ready to plug into a real agent backend.
 */
export default function AgentVerse({ client, onViewChanges }: AgentVerseProps) {
  const [themeId, setThemeId] = useState<ThemeId>(readTheme);
  const [rail, setRail] = useState<'team' | 'tasks'>('team');

  const theme = THEMES[themeId];
  // Live when the IDE exposes its AI bridge; demo (mock) otherwise.
  const live = useMemo(() => !client && hasElectronAI(), [client]);
  const agentClient = useMemo(
    () => client ?? (live ? createElectronAgentClient() : createMockAgentClient()),
    [client, live],
  );
  const world = useAgentWorld(theme, agentClient);

  const selectedAgent = useMemo(
    () => world.agents.find((a) => a.id === world.selectedId) ?? null,
    [world.agents, world.selectedId],
  );

  const nearbyAgentIds = useMemo(() => {
    if (!selectedAgent) return new Set<string>();
    const reachX = 3.4;
    const reachY = 2.4;
    return new Set(
      world.agents
        .filter((a) => a.id !== selectedAgent.id)
        .filter((a) => Math.abs(a.pos.x - selectedAgent.pos.x) <= reachX && Math.abs(a.pos.y - selectedAgent.pos.y) <= reachY)
        .map((a) => a.id),
    );
  }, [world.agents, selectedAgent]);

  const tasksByAgent = useMemo(() => {
    const map: Record<string, string | undefined> = {};
    for (const t of world.tasks) {
      if (t.status === 'in_progress' && t.assigneeId) map[t.assigneeId] = t.title;
    }
    return map;
  }, [world.tasks]);

  const changeTheme = (id: ThemeId) => {
    setThemeId(id);
    try {
      localStorage.setItem(THEME_KEY, id);
    } catch {
      /* ignore */
    }
  };

  return (
    <div className={`av-root av-root--${theme.id}`}>
      <Topbar theme={theme} kpis={world.kpis} live={live} onThemeChange={changeTheme} />

      <div className="av-stage">
        <GameWorld
          agents={world.agents}
          theme={theme}
          selectedId={world.selectedId}
          onSelect={world.selectAgent}
          onDeselect={() => world.selectAgent(null)}
        />

        <aside className="av-rail">
          <div className="av-rail__tabs">
            <button
              type="button"
              className={`av-rail__tab${rail === 'team' ? ' is-active' : ''}`}
              onClick={() => setRail('team')}
            >
              Equipe
            </button>
            <button
              type="button"
              className={`av-rail__tab${rail === 'tasks' ? ' is-active' : ''}`}
              onClick={() => setRail('tasks')}
            >
              Taches
            </button>
          </div>

          <div className="av-rail__body">
            {rail === 'team' ? (
              <AgentStatusPanel
                agents={world.agents}
                tasksByAgent={tasksByAgent}
                selectedId={world.selectedId}
                nearbyIds={nearbyAgentIds}
                pixel={theme.pixel}
                onSelect={world.selectAgent}
              />
            ) : (
              <TaskBoard tasks={world.tasks} agents={world.agents} onSelectAgent={world.selectAgent} onViewChanges={onViewChanges} />
            )}
          </div>
        </aside>
      </div>

      <DialoguePanel
        agent={selectedAgent}
        pixel={theme.pixel}
        onSend={(prompt) => selectedAgent && world.sendInstruction(selectedAgent.id, prompt)}
        onClose={() => world.selectAgent(null)}
      />
    </div>
  );
}
