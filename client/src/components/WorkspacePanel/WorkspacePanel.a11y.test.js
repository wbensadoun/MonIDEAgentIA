import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import WorkspacePanel from './index';

const baseProps = {
  workspaces: [{ path: '/project/demo', name: 'Demo' }],
  currentProjectPath: '/project/demo',
  projectRunState: {},
  isElectronApiAvailable: false,
  activeConversationFile: null,
  onOpenProject: jest.fn(),
};

afterEach(() => {
  delete window.electronAPI;
  jest.clearAllMocks();
});

test('project rows are keyboard-activatable and expose a focusable button contract', () => {
  const onSelectProject = jest.fn();
  render(<WorkspacePanel {...baseProps} onSelectProject={onSelectProject} />);

  const project = screen.getByRole('button', { name: 'Demo' });
  expect(project).toHaveAttribute('tabindex', '0');
  expect(project).toHaveClass('focus-ring');

  fireEvent.keyDown(project, { key: 'Enter' });
  fireEvent.keyDown(project, { key: ' ' });
  expect(onSelectProject).toHaveBeenCalledTimes(2);
  expect(onSelectProject).toHaveBeenCalledWith('/project/demo');
});

test('conversation rows can be opened with Enter without requiring a pointer', async () => {
  const onOpenConversation = jest.fn();
  window.electronAPI = {
    listConversations: jest.fn().mockResolvedValue({
      success: true,
      conversations: [{ fileName: 'session.json', title: 'Session de test', createdAt: '2026-09-04T12:00:00Z' }],
    }),
  };

  render(
    <WorkspacePanel
      {...baseProps}
      isElectronApiAvailable
      onOpenConversation={onOpenConversation}
    />
  );

  const conversation = await screen.findByRole('button', { name: 'Session de test' });
  expect(conversation).toHaveAttribute('tabindex', '0');
  fireEvent.keyDown(conversation, { key: 'Enter' });
  await waitFor(() => expect(onOpenConversation).toHaveBeenCalledWith('/project/demo', 'session.json'));
});
