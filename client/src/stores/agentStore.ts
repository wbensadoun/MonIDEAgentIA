import { create } from 'zustand';
import type { AgentRun, AgentLogEntry } from '../services/electron.bridge';

export interface Agent {
  name: string;
  description?: string;
  scope?: string;
  content?: string;
}

export interface Skill {
  name: string;
  description?: string;
  scope?: string;
  content?: string;
}

interface AgentState {
  agentRuns: AgentRun[];
  setAgentRuns: (runs: AgentRun[]) => void;
  addAgentRun: (run: AgentRun) => void;
  updateAgentRun: (runId: string, updates: Partial<AgentRun>) => void;
  removeAgentRun: (runId: string) => void;

  activeAgentRun: AgentRun | null;
  setActiveAgentRun: (run: AgentRun | null) => void;

  availableAgents: Agent[];
  setAvailableAgents: (agents: Agent[]) => void;
  addAgent: (agent: Agent) => void;

  activeAgent: Agent | null;
  setActiveAgent: (agent: Agent | null) => void;

  skills: Skill[];
  setSkills: (skills: Skill[]) => void;
  addSkill: (skill: Skill) => void;

  activeSkill: Skill | null;
  setActiveSkill: (skill: Skill | null) => void;

  agentRunsLoading: boolean;
  setAgentRunsLoading: (loading: boolean) => void;

  agentLibraryNonce: number;
  bumpLibraryNonce: () => void;
}

const useAgentStore = create<AgentState>((set) => ({
  agentRuns: [],
  setAgentRuns: (runs) => set({ agentRuns: runs }),
  addAgentRun: (run) => set((state) => ({
    agentRuns: [...state.agentRuns, run],
  })),
  updateAgentRun: (runId, updates) => set((state) => ({
    agentRuns: state.agentRuns.map(run =>
      run.id === runId ? { ...run, ...updates } : run
    ),
  })),
  removeAgentRun: (runId) => set((state) => ({
    agentRuns: state.agentRuns.filter(run => run.id !== runId),
  })),

  activeAgentRun: null,
  setActiveAgentRun: (run) => set({ activeAgentRun: run }),

  availableAgents: [],
  setAvailableAgents: (agents) => set({ availableAgents: agents }),
  addAgent: (agent) => set((state) => ({
    availableAgents: [...state.availableAgents, agent],
  })),

  activeAgent: null,
  setActiveAgent: (agent) => set({ activeAgent: agent }),

  skills: [],
  setSkills: (skills) => set({ skills }),
  addSkill: (skill) => set((state) => ({
    skills: [...state.skills, skill],
  })),

  activeSkill: null,
  setActiveSkill: (skill) => set({ activeSkill: skill }),

  agentRunsLoading: false,
  setAgentRunsLoading: (loading) => set({ agentRunsLoading: loading }),

  agentLibraryNonce: 0,
  bumpLibraryNonce: () => set((state) => ({
    agentLibraryNonce: state.agentLibraryNonce + 1,
  })),
}));

export type { AgentState };
export default useAgentStore;
