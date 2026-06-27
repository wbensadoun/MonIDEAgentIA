import { create } from 'zustand';

interface ProjectState {
  currentProjectPath: string;
  setCurrentProjectPath: (path: string) => void;

  workspaces: string[];
  setWorkspaces: (workspaces: string[]) => void;
  addWorkspace: (workspace: string) => void;
  removeWorkspace: (path: string) => void;

  projectFiles: string[];
  setProjectFiles: (files: string[]) => void;

  projectRunState: Record<string, unknown>;
  setProjectRunState: (state: Record<string, unknown>) => void;

  isProjectLoading: boolean;
  setIsProjectLoading: (loading: boolean) => void;

  projectError: string | null;
  setProjectError: (error: string | null) => void;

  trustedPaths: string[];
  addTrustedPath: (path: string) => void;
  setTrustedPaths: (paths: string[]) => void;
}

const useProjectStore = create<ProjectState>((set) => ({
  currentProjectPath: '',
  setCurrentProjectPath: (path) => set({ currentProjectPath: path }),

  workspaces: [],
  setWorkspaces: (workspaces) => set({ workspaces }),
  addWorkspace: (workspace) => set((state) => ({
    workspaces: [...state.workspaces, workspace],
  })),
  removeWorkspace: (path) => set((state) => ({
    workspaces: state.workspaces.filter(w => w !== path),
  })),

  projectFiles: [],
  setProjectFiles: (files) => set({ projectFiles: files }),

  projectRunState: {},
  setProjectRunState: (state) => set({ projectRunState: state }),

  isProjectLoading: false,
  setIsProjectLoading: (loading) => set({ isProjectLoading: loading }),

  projectError: null,
  setProjectError: (error) => set({ projectError: error }),

  trustedPaths: [],
  addTrustedPath: (path) => set((state) => ({
    trustedPaths: state.trustedPaths.includes(path) ? state.trustedPaths : [...state.trustedPaths, path],
  })),
  setTrustedPaths: (paths) => set({ trustedPaths: paths }),
}));

export type { ProjectState };
export default useProjectStore;
