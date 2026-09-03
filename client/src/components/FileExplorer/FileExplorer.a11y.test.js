import React from 'react';
import { render, screen } from '@testing-library/react';
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
