import React from 'react';
import { render, screen } from '@testing-library/react';
import Select from '../Select';

test('keeps native combobox semantics and applies the shared control class', () => {
  render(
    <Select aria-label="Mode">
      <option value="safe">Safe</option>
      <option value="full">Full</option>
    </Select>
  );

  expect(screen.getByRole('combobox', { name: 'Mode' })).toHaveClass('cc-select__control');
  expect(screen.getByText('⌄')).toHaveAttribute('aria-hidden', 'true');
});
