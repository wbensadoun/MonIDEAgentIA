/* eslint-env jest */
import React from 'react';
import { act } from 'react';
import { render } from '@testing-library/react';
import LivePreview from './index';

describe('LivePreview', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    act(() => {
      jest.runOnlyPendingTimers();
    });
    jest.useRealTimers();
  });

  test('auto refreshes when preview transitions to running', () => {
    const onRefresh = jest.fn();
    const { rerender } = render(
      <LivePreview
        projectId="demo"
        status="stopped"
        previewUrl="http://localhost:3004"
        onRefresh={onRefresh}
      />
    );

    rerender(
      <LivePreview
        projectId="demo"
        status="running"
        previewUrl="http://localhost:3004"
        onRefresh={onRefresh}
      />
    );

    act(() => {
      jest.advanceTimersByTime(500);
    });

    expect(onRefresh).toHaveBeenCalledTimes(1);
  });
});
