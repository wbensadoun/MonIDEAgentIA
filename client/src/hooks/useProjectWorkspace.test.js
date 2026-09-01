import { act, renderHook } from '@testing-library/react';
import useProjectWorkspace from './useProjectWorkspace';

const buildDeps = (overrides = {}) => ({
  currentProjectPath: 'C:/current',
  currentProjectId: 'rp_current_session_id',
  setCurrentProjectPath: jest.fn(),
  setCurrentProjectId: jest.fn(),
  isElectronApiAvailable: true,
  showMessage: jest.fn(),
  openFolder: jest.fn(),
  resetEditorSession: jest.fn(),
  isLoading: false,
  multiAIState: null,
  pendingFileChanges: [],
  activeConversationFile: null,
  loadConversationByFile: jest.fn(),
  ...overrides
});

beforeEach(() => {
  localStorage.clear();
  window.electronAPI = {
    closeProject: jest.fn()
  };
});

afterEach(() => {
  delete window.electronAPI;
});

test('historical workspace is removed when main process reports it is no longer open', async () => {
  localStorage.setItem('vibeIDE_workspaces', JSON.stringify([
    { path: 'C:/historical', name: 'historical' }
  ]));
  window.electronAPI.closeProject.mockResolvedValue({
    success: false,
    code: 'PROJECT_NOT_OPEN',
    error: 'Projet non ouvert.'
  });
  const { result } = renderHook(() => useProjectWorkspace(buildDeps()));

  await act(async () => {
    expect(await result.current.handleRemoveProject('C:/historical')).toBe(true);
  });

  expect(result.current.workspaces.some((workspace) => workspace.path === 'C:/historical')).toBe(false);
  expect(window.electronAPI.closeProject).toHaveBeenCalledWith('C:/historical');
});

test('closing the current workspace clears path and retrieval identity before reuse', async () => {
  const deps = buildDeps();
  window.electronAPI.closeProject.mockResolvedValue({ success: true });
  const { result } = renderHook(() => useProjectWorkspace(deps));

  await act(async () => {
    expect(await result.current.handleRemoveProject('C:/current')).toBe(true);
  });

  expect(deps.setCurrentProjectPath).toHaveBeenCalledWith('');
  expect(deps.setCurrentProjectId).toHaveBeenCalledWith('');
  expect(deps.resetEditorSession).toHaveBeenCalledTimes(1);
  expect(localStorage.getItem('lastProjectPath')).toBe('');
});
