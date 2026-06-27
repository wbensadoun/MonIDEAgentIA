import { create } from 'zustand';
import type { AgentChange, AISnapshot } from '../services/electron.bridge';

interface PendingState {
  pendingFileChanges: AgentChange[];
  setPendingFileChanges: (changes: AgentChange[]) => void;
  addPendingChange: (change: AgentChange) => void;
  removePendingChange: (changeId: string) => void;
  updatePendingChange: (changeId: string, updates: Partial<AgentChange>) => void;

  activePendingChangeId: string | null;
  setActivePendingChangeId: (id: string | null) => void;

  snapshots: AISnapshot[];
  setSnapshots: (snapshots: AISnapshot[]) => void;
  addSnapshot: (snapshot: AISnapshot) => void;
  removeSnapshot: (snapshotId: string) => void;

  activeSnapshot: AISnapshot | null;
  setActiveSnapshot: (snapshot: AISnapshot | null) => void;

  isApplyingChange: boolean;
  setIsApplyingChange: (applying: boolean) => void;

  pendingError: string | null;
  setPendingError: (error: string | null) => void;
}

const usePendingStore = create<PendingState>((set) => ({
  pendingFileChanges: [],
  setPendingFileChanges: (changes) => set({ pendingFileChanges: changes }),
  addPendingChange: (change) => set((state) => ({
    pendingFileChanges: [...state.pendingFileChanges, change],
  })),
  removePendingChange: (changeId) => set((state) => ({
    pendingFileChanges: state.pendingFileChanges.filter(c => c.id !== changeId),
  })),
  updatePendingChange: (changeId, updates) => set((state) => ({
    pendingFileChanges: state.pendingFileChanges.map(c =>
      c.id === changeId ? { ...c, ...updates } : c
    ),
  })),

  activePendingChangeId: null,
  setActivePendingChangeId: (id) => set({ activePendingChangeId: id }),

  snapshots: [],
  setSnapshots: (snapshots) => set({ snapshots }),
  addSnapshot: (snapshot) => set((state) => ({
    snapshots: [...state.snapshots, snapshot],
  })),
  removeSnapshot: (snapshotId) => set((state) => ({
    snapshots: state.snapshots.filter(s => s.id !== snapshotId),
  })),

  activeSnapshot: null,
  setActiveSnapshot: (snapshot) => set({ activeSnapshot: snapshot }),

  isApplyingChange: false,
  setIsApplyingChange: (applying) => set({ isApplyingChange: applying }),

  pendingError: null,
  setPendingError: (error) => set({ pendingError: error }),
}));

export type { PendingState };
export default usePendingStore;
