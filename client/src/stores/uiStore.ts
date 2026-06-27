import { create } from 'zustand';

interface UIState {
  theme: string;
  setTheme: (theme: string) => void;

  isExpertMode: boolean;
  toggleExpertMode: () => void;

  previewStatus: string;
  setPreviewStatus: (status: string) => void;

  settingsOpen: boolean;
  setSettingsOpen: (open: boolean) => void;
  openSettings: () => void;
  closeSettings: () => void;

  workflowManagerOpen: boolean;
  setWorkflowManagerOpen: (open: boolean) => void;
  openWorkflowManager: () => void;
  closeWorkflowManager: () => void;

  centerView: string;
  setCenterView: (view: string) => void;

  isTerminalOpen: boolean;
  setIsTerminalOpen: (open: boolean) => void;
  toggleTerminal: () => void;

  leftWidth: number;
  setLeftWidth: (width: number) => void;

  rightWidth: number;
  setRightWidth: (width: number) => void;

  runtimeDevPort: string;
  setRuntimeDevPort: (port: string) => void;
}

const useUIStore = create<UIState>((set) => ({
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

export type { UIState };
export default useUIStore;
