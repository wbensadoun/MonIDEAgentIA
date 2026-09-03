/**
 * COD-57 — les personas internes sont back-only pour un utilisateur normal.
 * Le mode Avancé conserve la surface de gestion pour les besoins développeur.
 */
import React from 'react';
import { render, screen, within, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import AutonomyControls, { AgentPersona } from '../AutonomyControls';

const AGENTS: AgentPersona[] = [
  { name: 'reviewer', description: 'Relit le code', scope: 'project' },
  { name: 'tester', description: 'Ecrit les tests', scope: 'user' }
];

const setup = (props: Partial<React.ComponentProps<typeof AutonomyControls>> = {}) => {
  const onExecutionModeChange = jest.fn();
  const onAutonomyLevelChange = jest.fn();
  const onActiveAgentChange = jest.fn();
  render(
    <AutonomyControls
      executionMode="agent"
      onExecutionModeChange={onExecutionModeChange}
      autonomyLevel="normal"
      onAutonomyLevelChange={onAutonomyLevelChange}
      onActiveAgentChange={onActiveAgentChange}
      {...props}
    />
  );
  return { onExecutionModeChange, onAutonomyLevelChange, onActiveAgentChange };
};

describe('AutonomyControls — personas back-only', () => {
  test('un utilisateur normal ne voit ni picker ni gestionnaire', () => {
    setup({ agents: AGENTS, onOpenAgentManager: jest.fn() });

    expect(screen.queryByRole('radiogroup', { name: 'Agent' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Gérer les agents' })).not.toBeInTheDocument();
    expect(screen.queryByText('reviewer')).not.toBeInTheDocument();
    expect(screen.getByRole('radiogroup', { name: "Mode d'exécution" })).toBeInTheDocument();
  });

  test('les trois modes produit restent disponibles sans persona', () => {
    setup({ agents: AGENTS });
    const modeGroup = screen.getByRole('radiogroup', { name: "Mode d'exécution" });
    expect(within(modeGroup).getAllByRole('radio').map((radio) => radio.textContent)).toEqual([
      '💬Ask',
      '📋Plan',
      '🔧Agent'
    ]);
  });

  test('le mode Avancé réaffiche le picker et le gestionnaire', () => {
    const onOpenAgentManager = jest.fn();
    setup({ agents: AGENTS, isDeveloperMode: true, onOpenAgentManager });

    expect(screen.getByRole('radiogroup', { name: 'Agent' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /reviewer/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Gérer les agents' }));
    expect(onOpenAgentManager).toHaveBeenCalled();
  });

  test('le routage/persona reste pilotable uniquement sur la surface Avancée', () => {
    const { onActiveAgentChange, onExecutionModeChange } = setup({
      agents: AGENTS,
      isDeveloperMode: true,
      executionMode: 'ask'
    });

    fireEvent.click(screen.getByRole('radio', { name: /reviewer/ }));
    expect(onActiveAgentChange).toHaveBeenCalledWith(AGENTS[0]);
    expect(onExecutionModeChange).toHaveBeenCalledWith('agent');
  });
});
