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
    onToggleChatSidebar: jest.fn(),
    isChatSidebarCollapsed: false,
    onToggleSwarmPanel: jest.fn(),
    isSwarmPanelOpen: false,
    isTerminalOpen: false,
    onToggleTerminal: jest.fn(),
    viewMode: 'ide',
    ...props
  };

  render(<AppTopbar {...baseProps} />);
  return baseProps;
};

test('IDE view exposes the three layout region toggles', () => {
  renderTopbar({ viewMode: 'ide' });

  expect(screen.getByTitle("Masquer l'explorateur")).toBeInTheDocument();
  expect(screen.getByTitle('Afficher le terminal')).toBeInTheDocument();
  expect(screen.getByTitle('Masquer le chat IA')).toBeInTheDocument();
  expect(screen.getByTitle('Personnaliser la disposition')).toBeInTheDocument();
});

test('Chat view swaps the layout toggles to its own panels', () => {
  renderTopbar({ viewMode: 'chat' });

  expect(screen.getByTitle('Masquer les projets')).toBeInTheDocument();
  expect(screen.getByTitle('Afficher les agents')).toBeInTheDocument();
  expect(screen.queryByTitle('Afficher le terminal')).not.toBeInTheDocument();
});

test('layout toggles call the handler for the active view', () => {
  const props = renderTopbar({ viewMode: 'chat' });

  fireEvent.click(screen.getByTitle('Afficher les agents'));

  expect(props.onToggleSwarmPanel).toHaveBeenCalled();
  expect(props.onToggleRightPanel).not.toHaveBeenCalled();
});

test('toggle titles reflect the collapsed state', () => {
  renderTopbar({ viewMode: 'ide', isLeftCollapsed: true, isTerminalOpen: true });

  expect(screen.getByTitle("Afficher l'explorateur")).toBeInTheDocument();
  expect(screen.getByTitle('Masquer le terminal')).toBeInTheDocument();
});

// Comme VS Code, la region masquee prend le glyphe "-off" (trait de
// separation) et non la zone pleine : l'etat ne se lit pas qu'a la couleur.
test('a visible region uses the filled glyph', () => {
  renderTopbar({ viewMode: 'ide', isLeftCollapsed: false });
  const btn = screen.getByTitle("Masquer l'explorateur");

  expect(btn.querySelectorAll('rect')).toHaveLength(2);
  expect(btn.querySelector('line')).toBeNull();
});

test('a hidden region swaps to the outline glyph', () => {
  renderTopbar({ viewMode: 'ide', isLeftCollapsed: true });
  const btn = screen.getByTitle("Afficher l'explorateur");

  expect(btn.querySelectorAll('rect')).toHaveLength(1);
  expect(btn.querySelector('line')).not.toBeNull();
});

test('customize menu lists each region with its visibility state', () => {
  renderTopbar({ viewMode: 'ide', isRightCollapsed: true });

  fireEvent.click(screen.getByTitle('Personnaliser la disposition'));

  expect(screen.getByRole('menuitemcheckbox', { name: "Panneau de l'explorateur" }))
    .toHaveAttribute('aria-checked', 'true');
  expect(screen.getByRole('menuitemcheckbox', { name: 'Panneau du chat IA' }))
    .toHaveAttribute('aria-checked', 'false');
});

test('customize menu item toggles its panel and closes the menu', () => {
  const props = renderTopbar({ viewMode: 'ide' });

  fireEvent.click(screen.getByTitle('Personnaliser la disposition'));
  fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Panneau du terminal' }));

  expect(props.onToggleTerminal).toHaveBeenCalled();
  expect(screen.queryByRole('menu')).not.toBeInTheDocument();
});

test('Escape closes the customize menu', () => {
  renderTopbar({ viewMode: 'ide' });

  fireEvent.click(screen.getByTitle('Personnaliser la disposition'));
  expect(screen.getByRole('menu')).toBeInTheDocument();

  fireEvent.keyDown(document, { key: 'Escape' });

  expect(screen.queryByRole('menu')).not.toBeInTheDocument();
});
