import { create } from 'zustand';

const useUIStore = create((set) => ({
  theme: 'dark',
  setTheme: (theme) => set({ theme }),

  isExpertMode: false,
  toggleExpertMode: () => set((state) => ({ isExpertMode: !state.isExpertMode })),

  previewStatus: 'default',
  setPreviewStatus: (status) => set({ previewStatus: status }),

  settingsOpen: false,
  setSettingsOpen: (open) => set({ settingsOpen: open }),
  openSettings: () => set({ settingsOpen: true }),
  closeSettings: () => set({ settingsOpen: false }),

  workflowManagerOpen: false,
  setWorkflowManagerOpen: (open) => set({ workflowManagerOpen: open }),
  openWorkflowManager: () => set({ workflowManagerOpen: true }),
  closeWorkflowManager: () => set({ workflowManagerOpen: false }),

  centerView: 'chat',
  setCenterView: (view) => set({ centerView: view }),

  viewMode: 'ide',
  setViewMode: (v) => set({ viewMode: v }),

  isTerminalOpen: false,
  setIsTerminalOpen: (open) => set({ isTerminalOpen: open }),
  toggleTerminal: () => set((state) => ({ isTerminalOpen: !state.isTerminalOpen })),

  leftWidth: 250,
  setLeftWidth: (width) => set({ leftWidth: width }),

  rightWidth: 300,
  setRightWidth: (width) => set({ rightWidth: width }),

  runtimeDevPort: '3000',
  setRuntimeDevPort: (port) => set({ runtimeDevPort: port }),
}));

export default useUIStore;
