import React from 'react';
import { render, screen } from '@testing-library/react';
import { IconButton, Pill } from '../Toolbar';

describe('Toolbar controls', () => {
  test('IconButton is non-submitting by default and names icon-only controls from title', () => {
    render(<IconButton icon={<span data-testid="icon" />} title="Ouvrir le terminal" />);

    const button = screen.getByRole('button', { name: 'Ouvrir le terminal' });
    expect(button).toHaveAttribute('type', 'button');
    expect(button).toHaveAttribute('aria-label', 'Ouvrir le terminal');
    expect(button).toHaveAttribute('aria-describedby');
  });

  test('IconButton preserves an explicit submit type for form actions', () => {
    render(<IconButton label="Enregistrer" type="submit" />);

    expect(screen.getByRole('button', { name: 'Enregistrer' })).toHaveAttribute('type', 'submit');
  });

  test('clickable Pill is also non-submitting by default', () => {
    render(<Pill label="Mode Agent" />);

    expect(screen.getByRole('button', { name: 'Mode Agent' })).toHaveAttribute('type', 'button');
  });
});
