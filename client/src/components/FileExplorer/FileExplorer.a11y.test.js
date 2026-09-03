import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import FileExplorer from './index';

const baseProps = {
  projectItems: [],
  currentProjectPath: 'C:/workspace',
  activeFile: '',
  expandedFolders: new Set(),
  newItemName: '',
  isElectronApiAvailable: true,
  onOpenFolder: jest.fn(),
  onCreateItem: jest.fn(),
  onRenameItem: jest.fn(),
  onMoveItem: jest.fn(),
  onDeleteItem: jest.fn(),
  onImportOsFiles: jest.fn(),
  onToggleFolder: jest.fn(),
  onFileClick: jest.fn(),
  onNewItemNameChange: jest.fn(),
};

test('FileExplorer keeps action buttons non-submitting by default', () => {
  render(<FileExplorer {...baseProps} />);

  expect(
    screen.getAllByRole('button').every((button) => button.getAttribute('type') === 'button')
  ).toBe(true);
});

test('FileExplorer uses the shared dialog for creating an item inside a folder', async () => {
  const onCreateItem = jest.fn().mockResolvedValue(true);
  render(
    <FileExplorer
      {...baseProps}
      onCreateItem={onCreateItem}
      projectItems={[{ type: 'directory', name: 'src', path: 'src', children: [] }]}
    />
  );

  fireEvent.contextMenu(screen.getByRole('button', { name: 'src' }));
  fireEvent.click(screen.getByRole('button', { name: 'Nouveau fichier' }));

  const input = screen.getByRole('textbox', { name: 'Nom' });
  fireEvent.change(input, { target: { value: 'index.js' } });
  fireEvent.click(screen.getByRole('button', { name: 'Créer' }));

  await waitFor(() => expect(onCreateItem).toHaveBeenCalledWith('file', 'index.js', 'src'));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
});
