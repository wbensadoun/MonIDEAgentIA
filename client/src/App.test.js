/* eslint-env jest */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import App from './App';

// AgentVerse loads Phaser lazily. Keep App navigation tests deterministic in
// jsdom, where Phaser's canvas feature detection is not available; the real
// AgentVerse module remains covered by its own component/build checks.
jest.mock('./components/AppShell/lazyAgentVerse', () => {
  const React = require('react');
  return function MockAgentVerse() {
    return React.createElement('div', null, 'AgentVerse');
  };
});

beforeEach(() => {
  delete window.electronAPI;
});

test('renders app without crashing', () => {
  render(<App />);
  expect(screen.getAllByText(/Code Companion/i).length).toBeGreaterThan(0);
});

test('global shortcuts ignore malformed events and form fields', () => {
  render(<App />);

  expect(() => fireEvent.keyDown(window, {})).not.toThrow();

  const input = document.createElement('input');
  document.body.appendChild(input);
  fireEvent.keyDown(input, { key: 'k', ctrlKey: true });

  expect(screen.queryByPlaceholderText(/Chercher une commande/i)).not.toBeInTheDocument();
  document.body.removeChild(input);
});

test('loads read-only permission mode from settings without forcing terminal access', async () => {
  window.electronAPI = {
    loadSettings: jest.fn().mockResolvedValue({
      success: true,
      settings: {
        permissionMode: 'read_only',
        defaultProvider: 'gemini',
        onboardingCompleted: true
      }
    })
  };

  render(<App />);

  await waitFor(() => {
    expect(screen.getAllByText('Lecture seule').length).toBeGreaterThan(0);
  });
});

test('toggles between IDE and Chat views via the ActivityBar rail', async () => {
  window.electronAPI = {
    loadSettings: jest.fn().mockResolvedValue({
      success: true,
      settings: {
        permissionMode: 'read_only',
        defaultProvider: 'gemini',
        onboardingCompleted: true
      }
    })
  };

  render(<App />);

  // Initially should show IDE view
  await waitFor(() => {
    expect(screen.getAllByText(/Code Companion/i).length).toBeGreaterThan(0);
  });

  // The persistent ActivityBar rail (replaces the old horizontal
  // AppViewSwitcher) exposes each view as an icon button labeled via
  // aria-label, since the rail itself has no visible text.
  const chatButton = screen.getByRole('button', { name: 'AI Chat' });
  expect(chatButton).toBeDefined();

  fireEvent.click(chatButton);

  // Verify Chat button is now active
  await waitFor(() => {
    expect(chatButton.classList.contains('is-active')).toBe(true);
  });

  expect(screen.getByRole('main', { name: /chat/i })).toBeInTheDocument();
});

test('AgentVerse icon opens the dedicated AgentVerse page without toggling a side panel', async () => {
  window.electronAPI = {
    loadSettings: jest.fn().mockResolvedValue({
      success: true,
      settings: { permissionMode: 'read_only', defaultProvider: 'gemini', onboardingCompleted: true }
    })
  };

  render(<App />);

  const agentVerseButton = screen.getByRole('button', { name: 'AgentVerse' });
  fireEvent.click(agentVerseButton);

  await waitFor(() => {
    expect(agentVerseButton.classList.contains('is-active')).toBe(true);
    expect(screen.getByRole('main', { name: 'AgentVerse' })).toBeInTheDocument();
  });
});
