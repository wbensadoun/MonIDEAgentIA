import { create } from 'zustand';

const useAgentStore = create((set) => ({
  agentRuns: [],
  setAgentRuns: (runs) => set({ agentRuns: runs }),
  addAgentRun: (run) => set((state) => ({
    agentRuns: [...state.agentRuns, run]
  })),
  updateAgentRun: (runId, updates) => set((state) => ({
    agentRuns: state.agentRuns.map(run =>
      run.id === runId ? { ...run, ...updates } : run
    )
  })),
  removeAgentRun: (runId) => set((state) => ({
    agentRuns: state.agentRuns.filter(run => run.id !== runId)
  })),

  activeAgentRun: null,
  setActiveAgentRun: (run) => set({ activeAgentRun: run }),

  availableAgents: [],
  setAvailableAgents: (agents) => set({ availableAgents: agents }),
  addAgent: (agent) => set((state) => ({
    availableAgents: [...state.availableAgents, agent]
  })),

  activeAgent: null,
  setActiveAgent: (agent) => set({ activeAgent: agent }),

  skills: [],
  setSkills: (skills) => set({ skills }),
  addSkill: (skill) => set((state) => ({
    skills: [...state.skills, skill]
  })),

  activeSkill: null,
  setActiveSkill: (skill) => set({ activeSkill: skill }),

  agentRunsLoading: false,
  setAgentRunsLoading: (loading) => set({ agentRunsLoading: loading }),

  agentLibraryNonce: 0,
  bumpLibraryNonce: () => set((state) => ({
    agentLibraryNonce: state.agentLibraryNonce + 1
  })),
}));

export default useAgentStore;
