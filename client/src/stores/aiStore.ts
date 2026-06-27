import { create } from 'zustand';

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp?: string;
  metadata?: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  type: string;
  name: string;
  input?: Record<string, unknown>;
  output?: unknown;
}

interface AIState {
  prompt: string;
  setPrompt: (prompt: string) => void;

  isLoading: boolean;
  setIsLoading: (loading: boolean) => void;

  history: ChatMessage[];
  addMessage: (message: ChatMessage) => void;
  clearHistory: () => void;
  setHistory: (history: ChatMessage[]) => void;

  currentCompletion: string | null;
  setCurrentCompletion: (completion: string | null) => void;

  isStreaming: boolean;
  setIsStreaming: (streaming: boolean) => void;

  streamChunks: string[];
  addStreamChunk: (chunk: string) => void;
  clearStreamChunks: () => void;

  multiAIState: Record<string, unknown>;
  setMultiAIState: (state: Record<string, unknown>) => void;

  selectedAgent: string | null;
  setSelectedAgent: (agent: string | null) => void;

  selectedSkill: string | null;
  setSelectedSkill: (skill: string | null) => void;

  toolCalls: ToolCall[];
  addToolCall: (call: ToolCall) => void;
  clearToolCalls: () => void;
}

const useAIStore = create<AIState>((set) => ({
  prompt: '',
  setPrompt: (prompt) => set({ prompt }),

  isLoading: false,
  setIsLoading: (loading) => set({ isLoading: loading }),

  history: [],
  addMessage: (message) => set((state) => ({
    history: [...state.history, message],
  })),
  clearHistory: () => set({ history: [] }),
  setHistory: (history) => set({ history }),

  currentCompletion: null,
  setCurrentCompletion: (completion) => set({ currentCompletion: completion }),

  isStreaming: false,
  setIsStreaming: (streaming) => set({ isStreaming: streaming }),

  streamChunks: [],
  addStreamChunk: (chunk) => set((state) => ({
    streamChunks: [...state.streamChunks, chunk],
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
    toolCalls: [...state.toolCalls, call],
  })),
  clearToolCalls: () => set({ toolCalls: [] }),
}));

export type { AIState };
export default useAIStore;
