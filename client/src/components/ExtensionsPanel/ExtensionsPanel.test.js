import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import ExtensionsPanel from './index';

jest.mock('../Settings/McpSettings', () => function McpSettingsMock() {
  return <div data-testid="mcp-settings">MCP controls</div>;
});

test('exposes the extensions hub and keeps the existing MCP surface mounted', () => {
  const onOpenPackManager = jest.fn();
  render(<ExtensionsPanel onOpenPackManager={onOpenPackManager} />);

  expect(screen.getByRole('heading', { name: 'Extensions & Connecteurs' })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Connecteurs MCP' })).toBeInTheDocument();
  expect(screen.getByTestId('mcp-settings')).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: /Gérer les Vibe Packs/i }));
  expect(onOpenPackManager).toHaveBeenCalledTimes(1);
});
