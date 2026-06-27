import { create } from 'zustand';

const usePendingStore = create((set) => ({
  pendingFileChanges: [],
  setPendingFileChanges: (changes) => set({ pendingFileChanges: changes }),
  addPendingChange: (change) => set((state) => ({
    pendingFileChanges: [...state.pendingFileChanges, change]
  })),
  removePendingChange: (changeId) => set((state) => ({
    pendingFileChanges: state.pendingFileChanges.filter(c => c.id !== changeId)
  })),
  updatePendingChange: (changeId, updates) => set((state) => ({
    pendingFileChanges: state.pendingFileChanges.map(c =>
      c.id === changeId ? { ...c, ...updates } : c
    )
  })),

  activePendingChangeId: null,
  setActivePendingChangeId: (id) => set({ activePendingChangeId: id }),

  snapshots: [],
  setSnapshots: (snapshots) => set({ snapshots }),
  addSnapshot: (snapshot) => set((state) => ({
    snapshots: [...state.snapshots, snapshot]
  })),
  removeSnapshot: (snapshotId) => set((state) => ({
    snapshots: state.snapshots.filter(s => s.id !== snapshotId)
  })),

  activeSnapshot: null,
  setActiveSnapshot: (snapshot) => set({ activeSnapshot: snapshot }),

  isApplyingChange: false,
  setIsApplyingChange: (applying) => set({ isApplyingChange: applying }),

  pendingError: null,
  setPendingError: (error) => set({ pendingError: error }),
}));

export default usePendingStore;
