/* eslint-env jest */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import App from './App';

beforeEach(() => {
  delete window.electronAPI;
});

test('renders app without crashing', () => {
  render(<App />);
  const brandElement = screen.getByText(/FuturIA/i);
  expect(brandElement).toBeInTheDocument();
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
