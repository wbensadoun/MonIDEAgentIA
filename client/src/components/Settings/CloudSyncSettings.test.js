import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import CloudSyncSettings from './CloudSyncSettings';

const makeApi = (overrides = {}) => ({
  cloudflareAgentsStatus: jest.fn().mockResolvedValue({ success: true, configured: true, enabled: true }),
  cloudflareAgentsList: jest.fn().mockImplementation((type) => Promise.resolve({ success: true, [type]: [] })),
  cloudflareAgentsPushAll: jest.fn().mockResolvedValue({ success: true, pushed: 1, failed: 0, total: 1 }),
  cloudflareAgentsPull: jest.fn().mockResolvedValue({ success: true }),
  ...overrides
});

const renderCloudSync = (api = makeApi()) => {
  window.electronAPI = api;
  const props = { isElectronApiAvailable: true, showMessage: jest.fn() };
  return { ...props, ...render(<CloudSyncSettings {...props} />) };
};

test('affiche le statut et les ressources distantes par type', async () => {
  const api = makeApi({
    cloudflareAgentsList: jest.fn().mockImplementation((type) => Promise.resolve({
      success: true,
      [type]: type === 'agents'
        ? [{ name: 'planner.md', size: 2048, updatedAt: '2026-09-04T18:00:00.000Z' }]
        : []
    }))
  });

  renderCloudSync(api);

  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Synchronisation active'));
  expect(await screen.findByText('planner.md')).toBeInTheDocument();
  expect(api.cloudflareAgentsList).toHaveBeenCalledWith('agents');
  expect(api.cloudflareAgentsList).toHaveBeenCalledWith('skills');
  expect(api.cloudflareAgentsList).toHaveBeenCalledWith('workflows');
});

test('publie toutes les catégories avec l’action globale', async () => {
  const api = makeApi();
  renderCloudSync(api);

  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Synchronisation active'));
  await waitFor(() => expect(screen.getByRole('button', { name: /Publier tout/i })).not.toBeDisabled());
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /Publier tout/i }));
  });

  expect(api.cloudflareAgentsPushAll).toHaveBeenNthCalledWith(1, 'agents');
  expect(api.cloudflareAgentsPushAll).toHaveBeenNthCalledWith(2, 'skills');
  expect(api.cloudflareAgentsPushAll).toHaveBeenNthCalledWith(3, 'workflows');
});

test('récupère une ressource distante dans la bibliothèque locale', async () => {
  const api = makeApi({
    cloudflareAgentsList: jest.fn().mockResolvedValue({
      success: true,
      agents: [{ name: 'planner.md', size: 20 }]
    })
  });
  renderCloudSync(api);

  await screen.findByText('planner.md');
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Récupérer planner.md' }));
  });

  expect(api.cloudflareAgentsPull).toHaveBeenCalledWith('planner.md', 'agents');
});

test('explique une configuration manquante et désactive les actions réseau', async () => {
  const api = makeApi({
    cloudflareAgentsStatus: jest.fn().mockResolvedValue({ success: true, configured: false, enabled: false })
  });
  renderCloudSync(api);

  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Non configuré'));
  expect(screen.getByText(/Renseignez CF_AGENTS_API_URL/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Publier tout/i })).toBeDisabled();
  expect(api.cloudflareAgentsList).not.toHaveBeenCalled();
});

test('reste utilisable sans l’API Electron', async () => {
  render(<CloudSyncSettings isElectronApiAvailable={false} showMessage={jest.fn()} />);

  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Indisponible hors application'));
  expect(screen.getByRole('button', { name: /Publier tout/i })).toBeDisabled();
});
