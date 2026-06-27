import { create } from 'zustand';

const useProjectStore = create((set) => ({
  currentProjectPath: '',
  setCurrentProjectPath: (path) => set({ currentProjectPath: path }),

  workspaces: [],
  setWorkspaces: (workspaces) => set({ workspaces }),
  addWorkspace: (workspace) => set((state) => ({
    workspaces: [...state.workspaces, workspace]
  })),
  removeWorkspace: (path) => set((state) => ({
    workspaces: state.workspaces.filter(w => w !== path)
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
    trustedPaths: state.trustedPaths.includes(path) ? state.trustedPaths : [...state.trustedPaths, path]
  })),
  setTrustedPaths: (paths) => set({ trustedPaths: paths }),
}));

export default useProjectStore;
