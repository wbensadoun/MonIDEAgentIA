import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import Settings from './index';

const baseSettings = {
  defaultProvider: 'kimi',
  geminiModel: 'gemini-3-flash-preview',
  claudeModel: 'claude-sonnet-4-6',
  kimiModel: 'moonshotai/Kimi-K2.7',
  multiAgentRoles: {
    selector: { provider: 'gemini', model: 'gemini-3.1-pro-preview' },
    frontend: { provider: 'kimi', model: 'moonshotai/Kimi-K2.5' },
    qa: { provider: 'kimi', model: 'moonshotai/Kimi-K2.5' },
    security: { provider: 'claude', model: 'claude-sonnet-4-6' }
  }
};

const renderSettings = () => {
  window.electronAPI = {
    loadSettings: jest.fn().mockResolvedValue({ success: true, settings: baseSettings }),
    saveSettings: jest.fn().mockResolvedValue({ success: true }),
    listOllamaModels: jest.fn().mockResolvedValue({ success: true, models: [] }),
    validateApiKey: jest.fn().mockResolvedValue({ valid: true })
  };

  const props = {
    isOpen: true,
    onClose: jest.fn(),
    isElectronApiAvailable: true,
    showMessage: jest.fn(),
    theme: 'midnight',
    onThemeChange: jest.fn()
  };

  const view = render(<Settings {...props} />);
  return { ...props, ...view };
};

test('saves custom remote models and applies provider model to matching roles only', async () => {
  renderSettings();

  await waitFor(() => {
    expect(screen.getByDisplayValue('moonshotai/Kimi-K2.7')).toBeInTheDocument();
  });

  fireEvent.click(screen.getByText('Appliquer aux roles Kimi / Together'));

  await waitFor(() => {
    expect(screen.getAllByDisplayValue('moonshotai/Kimi-K2.7').length).toBeGreaterThan(1);
  });

  await act(async () => {
    fireEvent.click(screen.getByText('Sauvegarder'));
  });

  await waitFor(() => {
    expect(window.electronAPI.saveSettings).toHaveBeenCalled();
  });

  const savedSettings = window.electronAPI.saveSettings.mock.calls[0][0];
  expect(savedSettings.kimiModel).toBe('moonshotai/Kimi-K2.7');
  expect(savedSettings.multiAgentRoles.frontend.model).toBe('moonshotai/Kimi-K2.7');
  expect(savedSettings.multiAgentRoles.qa.model).toBe('moonshotai/Kimi-K2.7');
  expect(savedSettings.multiAgentRoles.selector.model).toBe('gemini-3.1-pro-preview');
  expect(savedSettings.multiAgentRoles.security.model).toBe('claude-sonnet-4-6');
});

test('saves read-only permission mode from settings', async () => {
  renderSettings();

  const permissionSelect = await screen.findByDisplayValue('Edition + terminal');

  fireEvent.change(permissionSelect, { target: { value: 'read_only' } });

  await act(async () => {
    fireEvent.click(screen.getByText('Sauvegarder'));
  });

  await waitFor(() => {
    expect(window.electronAPI.saveSettings).toHaveBeenCalled();
  });

  expect(window.electronAPI.saveSettings.mock.calls[0][0].permissionMode).toBe('read_only');
});
