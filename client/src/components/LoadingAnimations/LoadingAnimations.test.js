import React from 'react';
import { render, screen } from '@testing-library/react';
import { AIWorkingIndicator, LoadingSteps } from './index';

beforeAll(() => {
  window.HTMLElement.prototype.scrollIntoView = jest.fn();
});

describe('renderer routing opacity', () => {
  test('working indicator keeps the wow signals without exposing routing data', () => {
    render(
      <AIWorkingIndicator
        provider="claude"
        streamingAgent="reviewer"
        statusText="reviewer utilise claude-sonnet"
        steps={[{ label: 'reviewer', provider: 'claude', model: 'claude-sonnet' }]}
        tokenCount={12}
      />
    );

    expect(screen.getByText('IA')).toBeInTheDocument();
    expect(screen.getAllByText('Traitement en cours...').length).toBeGreaterThan(0);
    expect(screen.getByText('Rôle 1')).toBeInTheDocument();
    expect(screen.getByText(/12 tokens/)).toBeInTheDocument();
    expect(screen.queryByText(/claude|reviewer|sonnet/i)).not.toBeInTheDocument();
  });

  test('step loader preserves progression while keeping step labels opaque', () => {
    render(
      <LoadingSteps
        currentStep={0}
        steps={[{ label: 'planner', provider: 'gemini' }]}
      />
    );

    expect(screen.getByText('Rôle 1')).toBeInTheDocument();
    expect(screen.queryByText(/planner|gemini/i)).not.toBeInTheDocument();
  });
});
