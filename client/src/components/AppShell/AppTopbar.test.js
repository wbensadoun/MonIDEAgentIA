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
    onOpenCommandPalette: jest.fn(),
    isExpertMode: false,
    onToggleExpertMode: jest.fn(),
    aiProvider: 'kimi',
    onAiProviderChange: jest.fn(),
    activeModelValue: 'moonshotai/Kimi-K2.5',
    availableActiveModels: ['moonshotai/Kimi-K2.5', 'moonshotai/Kimi-K2.6'],
    onActiveModelChange: jest.fn(),
    thinkingMode: false,
    onThinkingModeChange: jest.fn(),
    deepContextEnabled: false,
    onDeepContextEnabledChange: jest.fn(),
    isElectronApiAvailable: true,
    isLoading: false,
    multiAIState: null,
    resolvedOllamaModel: 'qwen3:latest',
    resolvedOllamaArchitect: 'qwen3:latest',
    resolvedOllamaCoder: 'qwen3:latest',
    resolvedOllamaTester: 'qwen3:latest',
    availableOllamaModels: ['qwen3:latest'],
    onOllamaSettingChange: jest.fn(),
    ollamaTopbarLabel: '',
    ollamaStatusLabel: '',
    showMessage: jest.fn(),
    onOpenFolder: jest.fn(),
    previewStatus: 'stopped',
    onTogglePreview: jest.fn(),
    onToggleLeftPanel: jest.fn(),
    isLeftCollapsed: false,
    onToggleRightPanel: jest.fn(),
    isRightCollapsed: false,
    onOpenWorkflowManager: jest.fn(),
    onOpenSettings: jest.fn(),
    theme: 'midnight',
    onThemeChange: jest.fn(),
    isTerminalOpen: false,
    onToggleTerminal: jest.fn(),
    ...props
  };

  render(<AppTopbar {...baseProps} />);
  return baseProps;
};

test('remote model input commits custom values from the topbar', () => {
  const props = renderTopbar();
  const input = screen.getByTitle('Modele Kimi / Together');

  fireEvent.change(input, { target: { value: '  moonshotai/Kimi-K2.7  ' } });
  fireEvent.keyDown(input, { key: 'Enter' });

  expect(props.onActiveModelChange).toHaveBeenCalledWith('moonshotai/Kimi-K2.7');
});

test('remote model input resets draft on escape', () => {
  renderTopbar();
  const input = screen.getByTitle('Modele Kimi / Together');

  fireEvent.change(input, { target: { value: 'moonshotai/Kimi-K2.7' } });
  fireEvent.keyDown(input, { key: 'Escape' });

  expect(input).toHaveValue('moonshotai/Kimi-K2.5');
});
