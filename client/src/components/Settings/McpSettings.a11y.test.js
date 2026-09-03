import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import McpSettings from './McpSettings';

test('McpSettings collects required variables through the shared dialog', async () => {
  const originalElectronApi = window.electronAPI;
  const mcpQuickAdd = jest.fn().mockResolvedValue({ success: true });
  window.electronAPI = {
    mcpListServers: jest.fn().mockResolvedValue({ success: true, servers: [] }),
    mcpGetCatalog: jest.fn().mockResolvedValue({
      success: true,
      catalog: [{ id: 'github', name: 'GitHub', requiredEnv: ['GITHUB_TOKEN'] }],
    }),
    mcpQuickAdd,
  };

  try {
    render(<McpSettings isElectronApiAvailable showMessage={jest.fn()} />);

    const catalogEntry = await screen.findByRole('button', { name: /GitHub/ });
    fireEvent.click(catalogEntry);

    const input = await screen.findByLabelText('Entrez la valeur pour GITHUB_TOKEN');
    fireEvent.change(input, { target: { value: 'secret-value' } });
    fireEvent.click(screen.getByRole('button', { name: 'Valider' }));

    await waitFor(() => expect(mcpQuickAdd).toHaveBeenCalledWith('github', { GITHUB_TOKEN: 'secret-value' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  } finally {
    window.electronAPI = originalElectronApi;
  }
});
