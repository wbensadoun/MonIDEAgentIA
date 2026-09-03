import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import ActivityBar from './ActivityBar';

test('exposes Extensions & Connecteurs and selects the sidebar section', () => {
  const onSidebarSectionChange = jest.fn();
  render(<ActivityBar onSidebarSectionChange={onSidebarSectionChange} />);

  const button = screen.getByRole('button', { name: 'Extensions & Connecteurs' });
  expect(button).toHaveAttribute('aria-pressed', 'false');

  fireEvent.click(button);
  expect(onSidebarSectionChange).toHaveBeenCalledWith('extensions');
});

test('marks Extensions & Connecteurs active when its section is selected', () => {
  render(<ActivityBar activeSidebarSection="extensions" />);
  expect(screen.getByRole('button', { name: 'Extensions & Connecteurs' }))
    .toHaveAttribute('aria-pressed', 'true');
});
