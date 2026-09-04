import React, { act } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import Tooltip from '../Tooltip';

describe('Tooltip', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  test('reveals its label after keyboard focus and hides it on blur', () => {
    render(
      <Tooltip label="Open settings" delay={250}>
        <button type="button" aria-label="Settings">Settings</button>
      </Tooltip>
    );

    const trigger = screen.getByRole('button', { name: 'Settings' });
    fireEvent.focus(trigger);
    act(() => {
      jest.advanceTimersByTime(250);
    });

    expect(screen.getByRole('tooltip')).toHaveTextContent('Open settings');
    expect(trigger).toHaveAttribute('aria-describedby');

    fireEvent.blur(trigger);
    expect(screen.getByRole('tooltip', { hidden: true })).toHaveAttribute('aria-hidden', 'true');
  });

  test('preserves the trigger handlers and supports hover', () => {
    const onMouseEnter = jest.fn();
    render(
      <Tooltip label="Search" delay={100}>
        <button type="button" onMouseEnter={onMouseEnter}>Search</button>
      </Tooltip>
    );

    const trigger = screen.getByRole('button', { name: 'Search' });
    fireEvent.mouseEnter(trigger);
    act(() => {
      jest.advanceTimersByTime(100);
    });

    expect(onMouseEnter).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('tooltip')).toBeVisible();
  });
});
