import { create } from 'zustand';

export interface OpenFile {
  path: string;
  name?: string;
  language?: string;
}

interface EditorState {
  activeFile: string | null;
  setActiveFile: (file: string | null) => void;

  code: string;
  setCode: (code: string) => void;

  openFiles: string[];
  addOpenFile: (file: string) => void;
  removeOpenFile: (file: string) => void;
  setOpenFiles: (files: string[]) => void;

  revealRequest: string | null;
  setRevealRequest: (request: string | null) => void;

  isDiffMode: boolean;
  setIsDiffMode: (isDiff: boolean) => void;

  diffFileA: string | null;
  setDiffFileA: (file: string | null) => void;

  diffFileB: string | null;
  setDiffFileB: (file: string | null) => void;
}

const useEditorStore = create<EditorState>((set) => ({
  activeFile: null,
  setActiveFile: (file) => set({ activeFile: file }),

  code: '',
  setCode: (code) => set({ code }),

  openFiles: [],
  addOpenFile: (file) => set((state) => ({
    openFiles: state.openFiles.some(f => f === file) ? state.openFiles : [...state.openFiles, file],
  })),
  removeOpenFile: (file) => set((state) => ({
    openFiles: state.openFiles.filter(f => f !== file),
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

export type { EditorState };
export default useEditorStore;
