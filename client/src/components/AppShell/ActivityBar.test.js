/* eslint-env jest */
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import ActivityBar from './ActivityBar';

test('AI Chat et AgentVerse déclenchent des navigations de vue dédiées', () => {
  const onViewModeChange = jest.fn();
  render(<ActivityBar viewMode="ide" onViewModeChange={onViewModeChange} />);

  fireEvent.click(screen.getByRole('button', { name: 'AI Chat' }));
  fireEvent.click(screen.getByRole('button', { name: 'AgentVerse' }));

  expect(onViewModeChange.mock.calls).toEqual([['chat'], ['agents']]);
});
