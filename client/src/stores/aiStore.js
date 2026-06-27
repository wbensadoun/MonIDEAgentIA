import { create } from 'zustand';

const useAIStore = create((set) => ({
  prompt: '',
  setPrompt: (prompt) => set({ prompt }),

  isLoading: false,
  setIsLoading: (loading) => set({ isLoading: loading }),

  history: [],
  addMessage: (message) => set((state) => ({
    history: [...state.history, message]
  })),
  clearHistory: () => set({ history: [] }),
  setHistory: (history) => set({ history }),

  currentCompletion: null,
  setCurrentCompletion: (completion) => set({ currentCompletion: completion }),

  isStreaming: false,
  setIsStreaming: (streaming) => set({ isStreaming: streaming }),

  streamChunks: [],
  addStreamChunk: (chunk) => set((state) => ({
    streamChunks: [...state.streamChunks, chunk]
  })),
  clearStreamChunks: () => set({ streamChunks: [] }),

  multiAIState: {},
  setMultiAIState: (state) => set({ multiAIState: state }),

  selectedAgent: null,
  setSelectedAgent: (agent) => set({ selectedAgent: agent }),

  selectedSkill: null,
  setSelectedSkill: (skill) => set({ selectedSkill: skill }),

  toolCalls: [],
  addToolCall: (call) => set((state) => ({
    toolCalls: [...state.toolCalls, call]
  })),
  clearToolCalls: () => set({ toolCalls: [] }),
}));

export default useAIStore;
