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
    closeProject: jest.fn(),
    authorizeProjectPath: jest.fn()
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

test('opening and selecting workspaces stores only main-process IDs, then clears them on close', async () => {
  const shared = {
    setCurrentProjectPath: jest.fn(),
    setCurrentProjectId: jest.fn()
  };
  const openFolder = jest.fn().mockResolvedValue({ path: 'C:/opened', projectId: 'rp_opened_session_id' });
  const depsFor = (path, projectId) => buildDeps({
    ...shared,
    currentProjectPath: path,
    currentProjectId: projectId,
    openFolder
  });
  const { result, rerender } = renderHook(
    ({ path, projectId }) => useProjectWorkspace(depsFor(path, projectId)),
    { initialProps: { path: '', projectId: '' } }
  );

  await act(async () => { await result.current.handleOpenFolder(); });
  expect(shared.setCurrentProjectPath).toHaveBeenCalledWith('C:/opened');
  expect(shared.setCurrentProjectId).toHaveBeenCalledWith('rp_opened_session_id');

  window.electronAPI.authorizeProjectPath.mockResolvedValue({
    success: true,
    path: 'C:/selected',
    projectId: 'rp_selected_session_id'
  });
  rerender({ path: 'C:/opened', projectId: 'rp_opened_session_id' });
  await act(async () => { await result.current.handleSelectProject('C:/selected'); });
  expect(shared.setCurrentProjectId).toHaveBeenCalledWith('rp_selected_session_id');

  window.electronAPI.closeProject.mockResolvedValue({ success: true });
  rerender({ path: 'C:/selected', projectId: 'rp_selected_session_id' });
  await act(async () => { await result.current.handleRemoveProject('C:/selected'); });
  expect(shared.setCurrentProjectPath).toHaveBeenCalledWith('');
  expect(shared.setCurrentProjectId).toHaveBeenCalledWith('');
});
