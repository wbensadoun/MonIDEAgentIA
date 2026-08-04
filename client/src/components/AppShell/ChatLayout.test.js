import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

jest.mock('./WorkspaceSidebar', () => function WorkspaceSidebarMock({ style }) {
  return <aside data-testid="chat-sidebar" style={style} />;
});
jest.mock('../AIChat', () => function AIChatMock() { return <div data-testid="chat-main">Chat</div>; });
jest.mock('../AgentSwarmPanel', () => function AgentSwarmPanelMock({ width }) {
  return <aside data-testid="swarm-panel" style={{ width }} />;
});

import ChatLayout, {
  CHAT_LAYOUT_VERSION,
  CHAT_MAIN_MIN_WIDTH,
  CHAT_SIDEBAR_MIN_WIDTH,
  SWARM_MIN_WIDTH
} from './ChatLayout';

const renderLayout = (props = {}) => render(
  <ChatLayout
    workspacePanelProps={{}}
    aiChatProps={{}}
    isSidebarCollapsed={false}
    isSwarmOpen={false}
    onToggleSwarmPanel={jest.fn()}
    {...props}
  />
);

beforeEach(() => {
  localStorage.clear();
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1448 });
  window.PointerEvent = MouseEvent;
  jest.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => ({
    width: 1400,
    height: 800,
    top: 0,
    left: 0,
    right: 1400,
    bottom: 800,
    x: 0,
    y: 0,
    toJSON: () => ({})
  }));
});

afterEach(() => {
  jest.restoreAllMocks();
  delete window.PointerEvent;
});

test('migrates the legacy sidebar percentage once and persists pixels', async () => {
  localStorage.setItem('code_companion_chatSidebarWidth', '20');
  renderLayout();

  expect(screen.getByTestId('chat-sidebar')).toHaveStyle({ width: '280px' });
  await waitFor(() => {
    expect(localStorage.getItem('code_companion_chatLayoutVersion')).toBe(String(CHAT_LAYOUT_VERSION));
    expect(localStorage.getItem('code_companion_chatSidebarWidth')).toBe('280');
  });
});

test('keyboard resizing is pixel-based, bounded and announced', () => {
  renderLayout();
  const separator = screen.getByRole('separator', { name: 'Redimensionner le panneau de gauche' });

  expect(separator).toHaveAttribute('aria-valuemin', String(CHAT_SIDEBAR_MIN_WIDTH));
  expect(separator).toHaveAttribute('aria-valuenow', '280');
  fireEvent.keyDown(separator, { key: 'ArrowRight' });
  expect(separator).toHaveAttribute('aria-valuenow', '300');
  expect(screen.getByTestId('chat-main').closest('main')).toHaveStyle({ minWidth: `${CHAT_MAIN_MIN_WIDTH}px` });
});

test('pointer drag uses capture semantics and persists the resulting pixels', async () => {
  renderLayout();
  const separator = screen.getByRole('separator', { name: 'Redimensionner le panneau de gauche' });
  separator.setPointerCapture = jest.fn();
  separator.hasPointerCapture = jest.fn(() => true);
  separator.releasePointerCapture = jest.fn();

  fireEvent.pointerDown(separator, { pointerId: 7, clientX: 100, button: 0 });
  fireEvent.pointerMove(separator, { pointerId: 7, clientX: 145 });
  fireEvent.pointerUp(separator, { pointerId: 7, clientX: 145 });

  expect(separator.setPointerCapture).toHaveBeenCalled();
  expect(screen.getByTestId('chat-sidebar')).toHaveStyle({ width: '325px' });
  await waitFor(() => expect(localStorage.getItem('code_companion_chatSidebarWidth')).toBe('325'));
  expect(document.body.style.cursor).toBe('');
});

test('agent panel has its own explicit minimum and mirrored keyboard direction', () => {
  renderLayout({ isSwarmOpen: true });
  const separator = screen.getByRole('separator', { name: 'Redimensionner le panneau des agents' });

  expect(separator).toHaveAttribute('aria-valuemin', String(SWARM_MIN_WIDTH));
  fireEvent.keyDown(separator, { key: 'ArrowLeft' });
  expect(separator).toHaveAttribute('aria-valuenow', '340');
  expect(screen.getByTestId('swarm-panel')).toHaveStyle({ width: '340px' });
});
