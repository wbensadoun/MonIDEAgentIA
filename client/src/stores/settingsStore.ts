import { create } from 'zustand';

export type AIProvider = 'gemini' | 'claude' | 'kimi' | 'ollama';
export type ExecutionMode = 'auto' | 'manual' | 'supervised';
export type PermissionMode = 'restricted' | 'normal' | 'permissive';
export type ContextMode = 'auto' | 'manual' | 'deep';
export type LocalAIOptimizationMode = 'off' | 'speed' | 'quality';

interface SettingsState {
  aiProvider: AIProvider;
  setAiProvider: (provider: AIProvider) => void;

  models: Record<string, string>;
  setModels: (models: Record<string, string>) => void;
  setModel: (provider: string, model: string) => void;

  executionMode: ExecutionMode;
  setExecutionMode: (mode: ExecutionMode) => void;

  permissionMode: PermissionMode;
  setPermissionMode: (mode: PermissionMode) => void;

  thinkingMode: boolean;
  setThinkingMode: (mode: boolean) => void;

  deepContextEnabled: boolean;
  setDeepContextEnabled: (enabled: boolean) => void;

  contextMode: ContextMode;
  setContextMode: (mode: ContextMode) => void;

  contextMaxFiles: number;
  setContextMaxFiles: (max: number) => void;

  localAIOptimizationMode: LocalAIOptimizationMode;
  setLocalAIOptimizationMode: (mode: LocalAIOptimizationMode) => void;

  localAIHardwareConsent: boolean;
  setLocalAIHardwareConsent: (consent: boolean) => void;

  qualityGateConfig: Record<string, unknown>;
  setQualityGateConfig: (config: Record<string, unknown>) => void;

  showOnboarding: boolean;
  completeOnboarding: () => void;

  isReadOnlyMode: boolean;
  setIsReadOnlyMode: (readonly: boolean) => void;

  ollamaModels: Record<string, unknown>;
  setOllamaModels: (models: Record<string, unknown>) => void;
}

const useSettingsStore = create<SettingsState>((set) => ({
  aiProvider: 'gemini',
  setAiProvider: (provider) => set({ aiProvider: provider }),

  models: {},
  setModels: (models) => set({ models }),
  setModel: (provider, model) => set((state) => ({
    models: { ...state.models, [provider]: model },
  })),

  executionMode: 'auto',
  setExecutionMode: (mode) => set({ executionMode: mode }),

  permissionMode: 'restricted',
  setPermissionMode: (mode) => set({ permissionMode: mode }),

  thinkingMode: false,
  setThinkingMode: (mode) => set({ thinkingMode: mode }),

  deepContextEnabled: true,
  setDeepContextEnabled: (enabled) => set({ deepContextEnabled: enabled }),

  contextMode: 'auto',
  setContextMode: (mode) => set({ contextMode: mode }),

  contextMaxFiles: 10,
  setContextMaxFiles: (max) => set({ contextMaxFiles: max }),

  localAIOptimizationMode: 'off',
  setLocalAIOptimizationMode: (mode) => set({ localAIOptimizationMode: mode }),

  localAIHardwareConsent: false,
  setLocalAIHardwareConsent: (consent) => set({ localAIHardwareConsent: consent }),

  qualityGateConfig: {},
  setQualityGateConfig: (config) => set({ qualityGateConfig: config }),

  showOnboarding: true,
  completeOnboarding: () => set({ showOnboarding: false }),

  isReadOnlyMode: false,
  setIsReadOnlyMode: (readonly) => set({ isReadOnlyMode: readonly }),

  ollamaModels: {},
  setOllamaModels: (models) => set({ ollamaModels: models }),
}));

export type { SettingsState };
export default useSettingsStore;
