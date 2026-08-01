import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

jest.mock('./WorkspaceSidebar', () => function WorkspaceSidebarMock({ style }) { return <aside data-testid="workspace-sidebar" style={style} />; });
jest.mock('../CodeEditor', () => function CodeEditorMock() { return <button data-testid="code-control">Code control</button>; });
jest.mock('../LivePreview', () => function LivePreviewMock() { return <button data-testid="preview-control">Preview control</button>; });
jest.mock('../TerminalPanel', () => function TerminalPanelMock() { return null; });
jest.mock('../GitPanel', () => function GitPanelMock() { return <button data-testid="git-control">Git control</button>; });
jest.mock('../VisualWorkflowEditor', () => function WorkflowMock() { return <button data-testid="workflow-control">Workflow control</button>; });
jest.mock('../AIChat', () => function AIChatMock() { return <div data-testid="ai-chat">Chat</div>; });
jest.mock('../AIChangesPanel', () => function ChangesMock() { return <button data-testid="changes-control">Changes control</button>; });
jest.mock('../BrainGraphPanel', () => function BrainMock() { return <button data-testid="brain-control">Brain control</button>; });

import WorkspaceLayout from './WorkspaceLayout';

const makeProps = (overrides = {}) => ({
  layoutRef: { current: null },
  leftWidth: 20,
  rightWidth: 20,
  middleWidth: 100,
  leftMinWidth: 220,
  leftMaxWidth: 500,
  rightMinWidth: 320,
  rightMaxWidth: 520,
  editorMinWidth: 480,
  isLeftCollapsed: true,
  isRightCollapsed: true,
  dragging: null,
  onDragStart: jest.fn(),
  resizeHandleProps: {},
  onResizeStep: jest.fn(),
  projectItems: [],
  expandedFolders: new Set(),
  isElectronApiAvailable: false,
  onCenterViewChange: jest.fn(),
  centerView: 'code',
  isFocusMode: false,
  isChatMaximized: false,
  onToggleFocusMode: jest.fn(),
  editorProps: {},
  previewProps: {},
  terminalProps: {},
  gitPanelProps: {},
  aiChangesPanelProps: {},
  brainGraphProps: {},
  workflowProps: {},
  aiChatProps: {},
  workspacePanelProps: {},
  isTerminalOpen: false,
  onToggleTerminal: jest.fn(),
  ...overrides
});

test('tabs expose their pane relationship and use a roving tab stop', () => {
  const props = makeProps();
  render(<WorkspaceLayout {...props} />);

  const codeTab = screen.getByRole('tab', { name: 'Code' });
  const previewTab = screen.getByRole('tab', { name: 'Aperçu' });

  expect(codeTab).toHaveAttribute('id', 'workspace-tab-code');
  expect(codeTab).toHaveAttribute('aria-controls', 'workspace-pane-code');
  expect(codeTab).toHaveAttribute('tabindex', '0');
  expect(previewTab).toHaveAttribute('tabindex', '-1');

  codeTab.focus();
  fireEvent.keyDown(codeTab, { key: 'ArrowRight' });
  expect(props.onCenterViewChange).toHaveBeenCalledWith('preview');
  expect(previewTab).toHaveFocus();
});

test('only the active pane remains keyboard-reachable without remounting persistent views', async () => {
  const props = makeProps();
  const { container, rerender } = render(<WorkspaceLayout {...props} />);

  const previewPane = container.querySelector('#workspace-pane-preview');
  expect(previewPane).toHaveAttribute('aria-hidden', 'true');
  expect(previewPane).toHaveAttribute('inert');
  await waitFor(() => expect(screen.getByTestId('preview-control')).toHaveAttribute('tabindex', '-1'));
  expect(container.querySelectorAll('[role="tabpanel"][tabindex="0"]')).toHaveLength(1);

  rerender(<WorkspaceLayout {...props} centerView="preview" />);

  expect(screen.getByTestId('code-control')).toHaveAttribute('tabindex', '-1');
  await waitFor(() => expect(screen.getByTestId('preview-control')).not.toHaveAttribute('tabindex'));
  expect(container.querySelectorAll('[role="tabpanel"][tabindex="0"]')).toHaveLength(1);
  expect(container.querySelector('#workspace-pane-code')).toBeInTheDocument();
  expect(container.querySelector('#workspace-pane-preview')).toBeInTheDocument();

  rerender(<WorkspaceLayout {...props} centerView="git" />);
  expect(container.querySelectorAll('[role="tabpanel"][tabindex="0"]')).toHaveLength(1);
  expect(container.querySelector('#workspace-pane-git')).toContainElement(screen.getByTestId('git-control'));
});

test('workspace regions use pixel widths and expose pixel separator values', () => {
  const props = makeProps({
    leftWidth: 280,
    rightWidth: 360,
    middleWidth: 620,
    isLeftCollapsed: false,
    isRightCollapsed: false
  });
  render(<WorkspaceLayout {...props} />);

  expect(screen.getByTestId('workspace-sidebar')).toHaveStyle({ width: '280px', minWidth: '220px' });
  expect(screen.getByTestId('ai-chat').parentElement).toHaveStyle({ width: '360px', minWidth: '320px' });

  const leftSeparator = screen.getByRole('separator', { name: 'Redimensionner le panneau de gauche' });
  expect(leftSeparator).toHaveAttribute('aria-valuemin', '220');
  expect(leftSeparator).toHaveAttribute('aria-valuemax', '500');
  expect(leftSeparator).toHaveAttribute('aria-valuenow', '280');

  fireEvent.keyDown(leftSeparator, { key: 'ArrowRight' });
  expect(props.onResizeStep).toHaveBeenCalledWith('left', 20);
});

test('chat maximize hides other regions and controlled restore brings them back', () => {
  const props = makeProps({
    leftWidth: 280,
    rightWidth: 360,
    middleWidth: 620,
    isLeftCollapsed: false,
    isRightCollapsed: false
  });
  const { rerender } = render(<WorkspaceLayout {...props} isChatMaximized />);
  expect(screen.queryByTestId('workspace-sidebar')).not.toBeInTheDocument();
  expect(screen.queryByRole('tab', { name: 'Code' })).not.toBeInTheDocument();
  expect(screen.getByTestId('ai-chat').parentElement).toHaveClass('is-maximized');
  expect(screen.getByTestId('ai-chat').parentElement).toHaveStyle({ width: '100%' });

  rerender(<WorkspaceLayout {...props} />);
  expect(screen.getByTestId('workspace-sidebar')).toBeInTheDocument();
  expect(screen.getByRole('tab', { name: 'Code' })).toBeInTheDocument();
});
