import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  Agent,
  AgentClient,
  AgentRoleKey,
  Task,
  TaskTag,
  ThemeMeta,
  WorldKpis,
} from '../types';
import { createAgents } from '../data/mockAgents';
import { createTasks } from '../data/mockTasks';
import {
  facingTo,
  randInt,
  samePos,
  stepToward,
  wanderTarget,
} from './movement';
import { doneLine, idleLine, reactLine, workLine } from './reactions';

const TICK_MS = 360;
const FEATURE_GOAL = 3;

/** Per-agent runtime data the engine needs but the domain model shouldn't carry. */
interface RuntimeMeta {
  dwellUntil: number;
  nextIdleBubbleAt: number;
  work?: {
    startedAt: number;
    /** Earliest time the work animation may complete (min visible duration). */
    minEndsAt: number;
    /** True once the real backend has resolved. Until then, progress is
     *  indeterminate — we never fake a percentage against a guessed duration. */
    resolved: boolean;
    reply: string;
    taskId: string;
    nextWorkBubbleAt: number;
    /** PM-only: agents to delegate to once the plan lands, in stage order. */
    delegateTo?: AgentRoleKey[];
    /** PM-only: the original objective, forwarded to delegated agents. */
    objective?: string;
  };
}

/**
 * Which roles a Product Manager delegates to, depending on the objective.
 * Ordered to mirror the real runtime stages: analysis → implementation →
 * validation. The PM is never bypassed — it plans first, then hands off.
 */
function planDelegation(tag: TaskTag): AgentRoleKey[] {
  switch (tag) {
    case 'design':
      return ['ux', 'frontend', 'qa'];
    case 'bug':
      return ['backend', 'qa'];
    case 'feature':
      return ['ux', 'frontend', 'backend', 'qa', 'devops'];
    default:
      return ['frontend', 'qa'];
  }
}

export interface AgentWorld {
  agents: Agent[];
  tasks: Task[];
  kpis: WorldKpis;
  selectedId: string | null;
  selectAgent: (id: string | null) => void;
  sendInstruction: (agentId: string, prompt: string) => void;
}

let idSeq = 0;
const uid = (prefix: string): string => `${prefix}${Date.now().toString(36)}${(idSeq++).toString(36)}`;

/** Detect a coarse task tag from the instruction text (purely cosmetic). */
function detectTag(prompt: string): TaskTag {
  const p = prompt.toLowerCase();
  if (/(bug|corrige|fix|erreur|crash|répare|repare)/.test(p)) return 'bug';
  if (/(design|maquette|ui|ux|style|couleur)/.test(p)) return 'design';
  if (/(ajoute|crée|cree|nouveau|feature|fonctionnalité|fonctionnalite|bouton)/.test(p)) return 'feature';
  return 'chore';
}

export function useAgentWorld(theme: ThemeMeta, client: AgentClient): AgentWorld {
  const agentsRef = useRef<Agent[]>(createAgents());
  const tasksRef = useRef<Task[]>(createTasks());
  const metaRef = useRef<Map<string, RuntimeMeta>>(new Map());
  const selectedRef = useRef<string | null>(null);
  const themeRef = useRef<ThemeMeta>(theme);
  const clientRef = useRef<AgentClient>(client);
  const delegationTimeouts = useRef<Set<number>>(new Set());

  themeRef.current = theme;
  clientRef.current = client;

  const [agents, setAgents] = useState<Agent[]>(() => agentsRef.current);
  const [tasks, setTasks] = useState<Task[]>(() => tasksRef.current);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const getMeta = useCallback((id: string): RuntimeMeta => {
    let meta = metaRef.current.get(id);
    if (!meta) {
      meta = { dwellUntil: Date.now() + randInt(400, 2600), nextIdleBubbleAt: Date.now() + randInt(2000, 7000) };
      metaRef.current.set(id, meta);
    }
    return meta;
  }, []);

  const publish = useCallback(() => {
    setAgents(agentsRef.current.map((a) => ({ ...a, bubble: a.bubble ? { ...a.bubble } : null })));
    setTasks(tasksRef.current.slice());
  }, []);

  const findAgent = useCallback((id: string | null): Agent | undefined => {
    if (!id) return undefined;
    return agentsRef.current.find((a) => a.id === id);
  }, []);

  // --- Animation / behaviour loop ---------------------------------------
  useEffect(() => {
    const loop = window.setInterval(() => {
      const now = Date.now();
      const th = themeRef.current;
      for (const agent of agentsRef.current) {
        tickAgent(agent, th, now, getMeta(agent.id), tasksRef.current, selectedRef.current, {
          agents: agentsRef.current,
          delegate: (sub, roleKey, objective) => {
            const target = agentsRef.current.find((a) => a.roleKey === roleKey);
            if (!target || target.status === 'working') return;
            beginWorkRef.current(target, sub, { logUser: false });
            target.bubble = { id: uid('b'), text: `Sur «${truncate(objective, 22)}» 👍`, kind: 'react', until: now + 3000 };
          },
          schedule: (fn, delay) => {
            const id = window.setTimeout(() => {
              delegationTimeouts.current.delete(id);
              fn();
            }, delay);
            delegationTimeouts.current.add(id);
          },
        });
      }
      publish();
    }, TICK_MS);
    return () => {
      window.clearInterval(loop);
      delegationTimeouts.current.forEach((id) => window.clearTimeout(id));
      delegationTimeouts.current.clear();
    };
  }, [getMeta, publish]);

  // Snap to whole tiles when entering the grid-based town theme.
  useEffect(() => {
    if (theme.movement !== 'grid') return;
    for (const agent of agentsRef.current) {
      agent.pos = { x: Math.round(agent.pos.x), y: Math.round(agent.pos.y) };
      agent.target = { x: Math.round(agent.target.x), y: Math.round(agent.target.y) };
    }
    publish();
  }, [theme.movement, publish]);

  // --- Actions ----------------------------------------------------------
  const selectAgent = useCallback((id: string | null) => {
    selectedRef.current = id;
    setSelectedId(id);
    for (const agent of agentsRef.current) {
      if (agent.id === id) {
        if (agent.status === 'idle' || agent.status === 'walking') {
          agent.status = 'talking';
          agent.target = { ...agent.pos };
          agent.facing = 'down';
        }
      } else if (agent.status === 'talking') {
        agent.status = 'idle';
      }
    }
    publish();
  }, [publish]);

  /**
   * Put one agent to work on a prompt: log it, create/track a task, kick the
   * backend call. Shared by direct instructions and PM delegation.
   *
   * @param logUser  whether to push the prompt as a user message (false for
   *                 auto-delegated sub-tasks, which aren't typed by the user).
   * @param delegate PM-only: roles to hand off to once the plan resolves.
   */
  const beginWork = useCallback((
    agent: Agent,
    prompt: string,
    opts: { logUser?: boolean; delegate?: AgentRoleKey[] } = {},
  ) => {
    const now = Date.now();
    const tag = detectTag(prompt);

    if (opts.logUser !== false) {
      agent.chat = [...agent.chat, { id: uid('m'), from: 'user', text: prompt, ts: now }];
    }

    const task: Task = {
      id: uid('t'),
      title: prompt.length > 64 ? `${prompt.slice(0, 61)}…` : prompt,
      status: 'in_progress',
      tag,
      assigneeId: agent.id,
      createdAt: now,
    };
    tasksRef.current = [...tasksRef.current, task];

    agent.status = 'working';
    agent.progress = -1; // indeterminate until the backend resolves (#1)
    agent.bubble = { id: uid('b'), text: workLine(agent.roleKey), kind: 'work', until: now + 3000 };

    clientRef.current
      .sendInstruction(agent, prompt)
      .then((result) => {
        const meta = getMeta(agent.id);
        const start = Date.now();
        meta.work = {
          startedAt: start,
          // Honour the backend's hint as a *minimum* visible duration, so fast
          // mock replies still animate; real (slow) replies gate on `resolved`.
          minEndsAt: start + Math.min(result.durationMs, 4000),
          resolved: true,
          reply: result.reply,
          taskId: task.id,
          nextWorkBubbleAt: start + randInt(1200, 2400),
          delegateTo: opts.delegate,
          objective: opts.delegate ? prompt : undefined,
        };
      })
      .catch(() => {
        const meta = getMeta(agent.id);
        meta.work = undefined;
        agent.status = selectedRef.current === agent.id ? 'talking' : 'idle';
        agent.progress = 0;
        agent.bubble = { id: uid('b'), text: 'Oups, réessaie 🙏', kind: 'react', until: Date.now() + 2600 };
        tasksRef.current = tasksRef.current.map((t) =>
          t.id === task.id ? { ...t, status: 'todo' } : t,
        );
        publish();
      });

    return tag;
  }, [getMeta, publish]);

  const sendInstruction = useCallback((agentId: string, prompt: string) => {
    const clean = prompt.trim();
    if (!clean) return;
    const agent = findAgent(agentId);
    if (!agent) return;

    const now = Date.now();
    // Mode 2: talking to the PM launches the team cascade — the PM plans first,
    // then delegates. Talking to any other agent is a direct micro-instruction.
    const teamMode = agent.roleKey === 'pm';
    const delegate = teamMode
      ? planDelegation(detectTag(clean)).filter((rk) =>
          agentsRef.current.some((a) => a.roleKey === rk))
      : undefined;

    beginWork(agent, clean, { delegate });

    if (teamMode) {
      agent.bubble = { id: uid('b'), text: 'Je cadre puis je délègue 📋', kind: 'work', until: now + 3200 };
    }

    // Bystanders acknowledge the new work (only when not about to be delegated).
    const others = agentsRef.current.filter(
      (a) => a.id !== agent.id &&
        (a.status === 'idle' || a.status === 'walking') &&
        !(delegate && delegate.includes(a.roleKey)),
    );
    for (let i = others.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [others[i], others[j]] = [others[j], others[i]];
    }
    others.slice(0, 2).forEach((a, idx) => {
      a.bubble = { id: uid('b'), text: reactLine(), kind: 'react', until: now + 2600 + idx * 400 };
    });

    publish();
  }, [beginWork, findAgent, publish]);

  /** Ref so the tick loop can trigger delegation without re-subscribing. */
  const beginWorkRef = useRef(beginWork);
  beginWorkRef.current = beginWork;

  // --- Derived KPIs -----------------------------------------------------
  const kpis = useMemo<WorldKpis>(() => {
    const total = tasks.length || 1;
    const done = tasks.filter((t) => t.status === 'done');
    const shipped = done.filter((t) => t.tag === 'feature').length;
    const bugs = tasks.filter((t) => t.tag === 'bug' && t.status !== 'done').length;
    return {
      shipped,
      goal: FEATURE_GOAL,
      bugs,
      completion: Math.round((done.length / total) * 100),
    };
  }, [tasks]);

  return { agents, tasks, kpis, selectedId, selectAgent, sendInstruction };
}

const truncate = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Sub-task phrasing handed to each delegated role. */
function subTaskFor(roleKey: AgentRoleKey, objective: string): string {
  const o = truncate(objective, 70);
  switch (roleKey) {
    case 'ux': return `Maquette le parcours pour : ${o}`;
    case 'frontend': return `Implémente le composant pour : ${o}`;
    case 'backend': return `Prépare l'API/les données pour : ${o}`;
    case 'qa': return `Écris les tests et cas limites pour : ${o}`;
    case 'devops': return `Prépare CI/preview/rollback pour : ${o}`;
    default: return o;
  }
}

interface TickHooks {
  agents: Agent[];
  delegate: (subTask: string, roleKey: AgentRoleKey, objective: string) => void;
  schedule: (fn: () => void, delay: number) => void;
}

/** Advance a single agent one tick. Mutates `agent` (and `tasks` on finalize). */
function tickAgent(
  agent: Agent,
  theme: ThemeMeta,
  now: number,
  meta: RuntimeMeta,
  tasks: Task[],
  selectedId: string | null,
  hooks: TickHooks,
): void {
  // Expire transient bubbles (talk bubbles persist while in dialogue).
  if (agent.bubble && now >= agent.bubble.until && agent.status !== 'talking') {
    agent.bubble = null;
  }

  if (agent.status === 'talking') {
    agent.facing = 'down';
    return;
  }

  if (agent.status === 'working') {
    // Return to the desk before "working".
    if (!samePos(agent.pos, agent.home)) {
      moveToward(agent, agent.home, theme);
      return;
    }
    agent.facing = 'down';

    const work = meta.work;
    if (!work) {
      // Backend hasn't accepted yet: keep progress indeterminate (#1).
      agent.progress = -1;
      return;
    }

    // Done only when the backend has resolved AND the minimum animation time
    // has elapsed. So slow real replies (Ollama-CPU) never "finish" early.
    const finished = work.resolved && now >= work.minEndsAt;

    if (!finished) {
      agent.progress = -1; // honest: still working, no fake percentage
      if (now >= work.nextWorkBubbleAt) {
        agent.bubble = { id: uid('b'), text: workLine(agent.roleKey), kind: 'work', until: now + 2600 };
        work.nextWorkBubbleAt = now + randInt(2600, 4200);
      }
      return;
    }

    // Finalize.
    const task = tasks.find((t) => t.id === work.taskId);
    if (task) task.status = 'done';
    agent.chat = [...agent.chat, { id: uid('m'), from: 'agent', text: work.reply, ts: now }];
    agent.progress = 0;
    agent.status = selectedId === agent.id ? 'talking' : 'idle';
    agent.bubble = { id: uid('b'), text: doneLine(), kind: 'done', until: now + 2800 };

    // PM cascade (#2): once the plan lands, delegate to each role in stage order,
    // staggered so the hand-offs read as a sequence rather than a burst.
    if (work.delegateTo && work.objective) {
      const objective = work.objective;
      work.delegateTo.forEach((roleKey, i) => {
        hooks.schedule(() => {
          hooks.delegate(subTaskFor(roleKey, objective), roleKey, objective);
        }, 500 + i * 900);
      });
      agent.bubble = { id: uid('b'), text: 'Équipe, à vous ! 🚀', kind: 'done', until: now + 3200 };
    }

    meta.work = undefined;
    meta.dwellUntil = now + randInt(1400, 3000);
    return;
  }

  // idle / walking
  if (theme.movement === 'grid') {
    if (samePos(agent.pos, agent.target)) {
      if (agent.status === 'walking') agent.status = 'idle';
      if (now >= meta.dwellUntil) {
        agent.target = wanderTarget(agent.home, theme);
        meta.dwellUntil = now + randInt(1600, 4200);
      }
    } else {
      const step = stepToward(agent.pos, agent.target);
      agent.pos = step.pos;
      agent.facing = step.facing;
      agent.status = 'walking';
    }
  } else if (now >= meta.dwellUntil) {
    const t = wanderTarget(agent.home, theme);
    agent.facing = facingTo(agent.pos, t);
    agent.pos = t;
    agent.target = t;
    agent.status = 'idle';
    meta.dwellUntil = now + randInt(2800, 5400);
  }

  // Ambient chatter.
  if (now >= meta.nextIdleBubbleAt) {
    if (!agent.bubble && Math.random() < 0.45) {
      agent.bubble = { id: uid('b'), text: idleLine(agent.roleKey), kind: 'idle', until: now + 2800 };
    }
    meta.nextIdleBubbleAt = now + randInt(5200, 11000);
  }
}

function moveToward(agent: Agent, dest: Agent['home'], theme: ThemeMeta): void {
  if (theme.movement === 'grid') {
    const step = stepToward(agent.pos, dest);
    agent.pos = step.pos;
    agent.facing = step.facing;
  } else {
    agent.facing = facingTo(agent.pos, dest);
    agent.pos = { ...dest };
  }
}
