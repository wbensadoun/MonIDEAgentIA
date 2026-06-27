import { create } from 'zustand';

const useSettingsStore = create((set) => ({
  aiProvider: 'gemini',
  setAiProvider: (provider) => set({ aiProvider: provider }),

  models: {},
  setModels: (models) => set({ models }),
  setModel: (provider, model) => set((state) => ({
    models: { ...state.models, [provider]: model }
  })),

  apiKeys: {},
  setApiKeys: (keys) => set({ apiKeys: keys }),
  setApiKey: (provider, key) => set((state) => ({
    apiKeys: { ...state.apiKeys, [provider]: key }
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

export default useSettingsStore;
