import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import Settings from './index';
import { resetProviderModelsStore } from '../../utils/providerModelsStore';

// Le cache de detection est un singleton module-level (partage avec le reste
// de l'app pour eviter des requetes dupliquees) : sans reset, la detection
// mockee d'un test fuiterait vers le suivant.
beforeEach(() => {
  resetProviderModelsStore();
});

const baseSettings = {
  defaultProvider: 'kimi',
  geminiModel: 'gemini-3-flash-preview',
  claudeModel: 'claude-sonnet-4-6',
  kimiModel: 'moonshotai/Kimi-K2.7',
  qwenModel: 'qwen-coder-plus',
  kimiApiKey: 'tgp_v1_test',
  permissionMode: 'edit_terminal',
  multiAgentRoles: {
    selector: { provider: 'gemini', model: 'gemini-3.1-pro-preview' },
    frontend: { provider: 'kimi', model: 'moonshotai/Kimi-K2.5' },
    qa: { provider: 'kimi', model: 'moonshotai/Kimi-K2.5' },
    security: { provider: 'claude', model: 'claude-sonnet-4-6' }
  }
};

const renderSettings = ({ listProviderModels } = {}) => {
  window.electronAPI = {
    loadSettings: jest.fn().mockResolvedValue({ success: true, settings: baseSettings }),
    saveSettings: jest.fn().mockResolvedValue({ success: true }),
    listProviderModels: listProviderModels
      || jest.fn().mockResolvedValue({ success: true, valid: false, models: [], error: 'offline' }),
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

  fireEvent.click(screen.getByText('Fournisseurs'));

  await waitFor(() => {
    expect(screen.queryAllByDisplayValue('moonshotai/Kimi-K2.7').length).toBeGreaterThan(0);
  });

  fireEvent.click(screen.getByText('Appliquer ce modèle aux rôles Moonshot Kimi'));

  fireEvent.click(screen.getByText('Agents'));

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

  fireEvent.click(screen.getByText('Permissions'));

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

test('saves the selected Qwen DashScope model without rendering a secret field', async () => {
  renderSettings();

  fireEvent.change(screen.getByLabelText('Fournisseur par défaut'), { target: { value: 'dashscope' } });
  fireEvent.click(screen.getByText('Fournisseurs'));

  const qwenModel = await screen.findByLabelText('Modèle Qwen / DashScope');
  expect(screen.queryByLabelText('Clé API Qwen / DashScope')).not.toBeInTheDocument();
  fireEvent.change(qwenModel, { target: { value: 'qwen-coder-next' } });

  await act(async () => {
    fireEvent.click(screen.getByText('Sauvegarder'));
  });

  await waitFor(() => {
    expect(window.electronAPI.saveSettings).toHaveBeenCalled();
  });

  const savedSettings = window.electronAPI.saveSettings.mock.calls[0][0];
  expect(savedSettings.defaultProvider).toBe('dashscope');
  expect(savedSettings.qwenModel).toBe('qwen-coder-next');
});

test('lists models detected from the provider instead of the hardcoded fallback', async () => {
  const listProviderModels = jest.fn().mockImplementation((provider) => {
    if (provider === 'kimi') {
      return Promise.resolve({
        success: true,
        valid: true,
        models: ['moonshotai/Kimi-K9-future', 'moonshotai/Kimi-K2.5']
      });
    }
    return Promise.resolve({ success: true, valid: false, models: [], error: 'offline' });
  });

  renderSettings({ listProviderModels });

  fireEvent.click(screen.getByText('Fournisseurs'));

  // La detection est debouncee : on attend qu'elle ait ete declenchee par fournisseur.
  await waitFor(() => {
    expect(listProviderModels).toHaveBeenCalledWith('kimi', 'tgp_v1_test');
  }, { timeout: 3000 });

  // Un modele inconnu du catalogue code en dur doit apparaitre dans les options.
  await waitFor(() => {
    expect(screen.getByText('2 modèles détectés')).toBeInTheDocument();
  });

  const options = Array.from(document.querySelectorAll('#provider-models-kimi option'))
    .map((option) => option.value);
  expect(options).toContain('moonshotai/Kimi-K9-future');
});

test('reports a detection failure on the provider card', async () => {
  const listProviderModels = jest.fn().mockResolvedValue({
    success: true,
    valid: false,
    models: [],
    error: 'Request failed with status code 401'
  });

  renderSettings({ listProviderModels });

  fireEvent.click(screen.getByText('Fournisseurs'));

  await waitFor(() => {
    expect(screen.getAllByText('Request failed with status code 401').length).toBeGreaterThan(0);
  }, { timeout: 3000 });
});
