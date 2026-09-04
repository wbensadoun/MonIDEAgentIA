import React from 'react';
import { render, screen } from '@testing-library/react';
import Button from '../Button';

test('defaults to a non-submitting action button', () => {
  render(<Button>Action</Button>);

  expect(screen.getByRole('button', { name: 'Action' })).toHaveAttribute('type', 'button');
});

test('preserves submit intent and exposes loading state', () => {
  render(
    <Button type="submit" loading>
      Enregistrer
    </Button>
  );

  const button = screen.getByRole('button', { name: 'Enregistrer' });
  expect(button).toHaveAttribute('type', 'submit');
  expect(button).toBeDisabled();
  expect(button).toHaveAttribute('aria-busy', 'true');
});
