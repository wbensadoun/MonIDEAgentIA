import { create } from 'zustand';

const useEditorStore = create((set) => ({
  activeFile: null,
  setActiveFile: (file) => set({ activeFile: file }),

  code: '',
  setCode: (code) => set({ code }),

  openFiles: [],
  addOpenFile: (file) => set((state) => ({
    openFiles: state.openFiles.some(f => f === file) ? state.openFiles : [...state.openFiles, file]
  })),
  removeOpenFile: (file) => set((state) => ({
    openFiles: state.openFiles.filter(f => f !== file)
  })),
  setOpenFiles: (files) => set({ openFiles: files }),

  revealRequest: null,
  setRevealRequest: (request) => set({ revealRequest: request }),

  isDiffMode: false,
  setIsDiffMode: (isDiff) => set({ isDiffMode: isDiff }),

  diffFileA: null,
  setDiffFileA: (file) => set({ diffFileA: file }),

  diffFileB: null,
  setDiffFileB: (file) => set({ diffFileB: file }),
}));

export default useEditorStore;
