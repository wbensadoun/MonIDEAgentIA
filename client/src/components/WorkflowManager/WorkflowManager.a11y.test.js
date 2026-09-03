import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import WorkflowManager from './index';

const baseProps = {
  workflows: [{ name: 'deploy', scope: 'global', description: 'Déploiement', body: '' }],
  isLoading: false,
  onSave: jest.fn(),
  onDelete: jest.fn().mockResolvedValue(undefined),
  onTrigger: jest.fn(),
  onClose: jest.fn(),
  currentProjectPath: '',
  showMessage: jest.fn(),
  isElectronApiAvailable: false,
  onLibraryUpdated: jest.fn(),
};

test('WorkflowManager confirms destructive actions with the shared dialog', async () => {
  render(<WorkflowManager {...baseProps} />);

  fireEvent.click(screen.getByRole('button', { name: 'Del' }));

  expect(screen.getByRole('dialog', { name: 'Supprimer le workflow' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Supprimer' }));

  await waitFor(() => expect(baseProps.onDelete).toHaveBeenCalledWith('deploy', 'global'));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
});
