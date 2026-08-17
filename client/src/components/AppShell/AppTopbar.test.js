import { fireEvent, render, screen } from '@testing-library/react';

jest.mock('../UpdateChecker', () => () => null);

import AppTopbar from './AppTopbar';

const renderTopbar = (props = {}) => {
  window.electronAPI = {
    loadSettings: jest.fn().mockResolvedValue({ success: true, settings: {} }),
    checkOllamaUpdates: jest.fn().mockResolvedValue({ success: true, models: [] }),
    onOllamaPullProgress: jest.fn(() => jest.fn())
  };

  const baseProps = {
    projectName: 'Projet',
    currentProjectPath: 'C:/Projet',
    displayedActiveFile: '',
    isStreamingCodePreview: false,
    gitDiffPreview: null,
    isExpertMode: false,
    onToggleExpertMode: jest.fn(),
    isElectronApiAvailable: true,
    onOpenFolder: jest.fn(),
    previewStatus: 'stopped',
    onTogglePreview: jest.fn(),
    onToggleLeftPanel: jest.fn(),
    isLeftCollapsed: false,
    onToggleRightPanel: jest.fn(),
    isRightCollapsed: false,
    isChatMaximized: false,
    onToggleChatMaximize: jest.fn(),
    onToggleChatSidebar: jest.fn(),
    isChatSidebarCollapsed: false,
    onToggleSwarmPanel: jest.fn(),
    isSwarmPanelOpen: false,
    isTerminalOpen: false,
    onToggleTerminal: jest.fn(),
    ...props
  };

  render(<AppTopbar {...baseProps} />);
  return baseProps;
};

test('IDE view exposes the three layout region toggles', () => {
  renderTopbar();

  expect(screen.getByTitle("Masquer l'explorateur")).toBeInTheDocument();
  expect(screen.getByTitle('Afficher le terminal')).toBeInTheDocument();
  expect(screen.getByTitle('Masquer le chat IA')).toBeInTheDocument();
  expect(screen.getByTitle('Personnaliser la disposition')).toBeInTheDocument();
});

test('layout toggles call their handlers in IDE mode', () => {
  const props = renderTopbar({ isTerminalOpen: true });

  fireEvent.click(screen.getByTitle('Masquer le terminal'));

  expect(props.onToggleTerminal).toHaveBeenCalled();
});

test('toggle titles reflect the collapsed state', () => {
  renderTopbar({ isLeftCollapsed: true, isTerminalOpen: true });

  expect(screen.getByTitle("Afficher l'explorateur")).toBeInTheDocument();
  expect(screen.getByTitle('Masquer le terminal')).toBeInTheDocument();
});

// Comme VS Code, la region masquee prend le glyphe "-off" (trait de
// separation) et non la zone pleine : l'etat ne se lit pas qu'a la couleur.
test('a visible region uses the filled glyph', () => {
  renderTopbar({ isLeftCollapsed: false });
  const btn = screen.getByTitle("Masquer l'explorateur");

  expect(btn.querySelectorAll('rect')).toHaveLength(2);
  expect(btn.querySelector('line')).toBeNull();
});

test('a hidden region swaps to the outline glyph', () => {
  renderTopbar({ isLeftCollapsed: true });
  const btn = screen.getByTitle("Afficher l'explorateur");

  expect(btn.querySelectorAll('rect')).toHaveLength(1);
  expect(btn.querySelector('line')).not.toBeNull();
});

test('customize menu lists each region with its visibility state', () => {
  renderTopbar({ isRightCollapsed: true });

  fireEvent.click(screen.getByTitle('Personnaliser la disposition'));

  expect(screen.getByRole('menuitemcheckbox', { name: "Panneau de l'explorateur" }))
    .toHaveAttribute('aria-checked', 'true');
  expect(screen.getByRole('menuitemcheckbox', { name: 'Panneau du chat IA' }))
    .toHaveAttribute('aria-checked', 'false');
});

test('customize menu item toggles its panel and closes the menu', () => {
  const props = renderTopbar();

  fireEvent.click(screen.getByTitle('Personnaliser la disposition'));
  fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Panneau du terminal' }));

  expect(props.onToggleTerminal).toHaveBeenCalled();
  expect(screen.queryByRole('menu')).not.toBeInTheDocument();
});

test('Escape closes the customize menu', () => {
  renderTopbar();

  fireEvent.click(screen.getByTitle('Personnaliser la disposition'));
  expect(screen.getByRole('menu')).toBeInTheDocument();

  fireEvent.keyDown(document, { key: 'Escape' });

  expect(screen.queryByRole('menu')).not.toBeInTheDocument();
});

test('chat maximize has a dedicated topbar control and restores through the same control', () => {
  const props = renderTopbar();
  const maximizeButton = screen.getByTitle('Maximiser le chat');
  maximizeButton.focus();
  fireEvent.click(maximizeButton);
  expect(props.onToggleChatMaximize).toHaveBeenCalledTimes(1);

  // The focused topbar control remains mounted, so keyboard focus is not lost
  // when the workspace swaps from three columns to the chat-only region.
  expect(maximizeButton).toHaveFocus();
});

test('chat maximize control is hidden when the chat region is collapsed', () => {
  renderTopbar({ isRightCollapsed: true });
  expect(screen.queryByTitle('Maximiser le chat')).not.toBeInTheDocument();
});
