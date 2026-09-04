/* eslint-env jest */
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

// Keep this test focused on App's navigation contract. The full workspace
// imports Monaco/xterm, while AgentVerse imports Phaser; both have dedicated
// suites and are not needed to prove the callback wiring here.
jest.mock('./components/AppShell/WorkspaceLayout', () => function MockWorkspaceLayout({ aiChatProps }) {
  return (
    <div>
      <button type="button" onClick={aiChatProps.onOpenAgentManager}>
        Configurer les agents...
      </button>
    </div>
  );
});

jest.mock('./components/AppShell/ChatLayout', () => function MockChatLayout() {
  return <main aria-label="Chat principal" />;
});

jest.mock('./components/AppShell/lazyAgentVerse', () => function MockAgentVerse() {
  return <div>AgentVerse</div>;
});

import App from './App';

beforeEach(() => {
  window.electronAPI = {
    loadSettings: jest.fn().mockResolvedValue({
      success: true,
      settings: { permissionMode: 'read_only', defaultProvider: 'gemini', onboardingCompleted: true }
    })
  };
});

test('Configurer les agents ouvre AgentVerse via le même contrat de navigation', async () => {
  render(<App />);

  fireEvent.click(screen.getByRole('button', { name: 'Configurer les agents...' }));

  await waitFor(() => {
    expect(screen.getByRole('button', { name: 'AgentVerse' }).classList.contains('is-active')).toBe(true);
    expect(screen.getByRole('main', { name: 'AgentVerse' })).toBeInTheDocument();
  });
});
