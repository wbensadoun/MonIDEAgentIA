/**
 * 1.4b — selection de persona dans AutonomyControls.
 *
 * La regle metier verrouillee ici vient de AgentModePill (index.js:225-238) :
 * mode et persona sont mutuellement exclusifs a l'affichage, choisir une
 * persona force le mode 'agent'. Si les deux surfaces divergent, l'utilisateur
 * voit deux controles actifs contradictoires — d'ou ces tests.
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

describe('AutonomyControls — rangee Agent', () => {
  test('sans agents, aucune rangee Agent n\'est rendue', () => {
    setup();
    expect(screen.queryByRole('radiogroup', { name: 'Agent' })).not.toBeInTheDocument();
  });

  test('avec des agents, chaque persona a un radio plus l\'option « Aucun »', () => {
    setup({ agents: AGENTS });
    const group = screen.getByRole('radiogroup', { name: 'Agent' });
    const radios = within(group).getAllByRole('radio');
    expect(radios.map((r) => r.textContent)).toEqual(['Aucun', '👤reviewer', '👤tester']);
  });

  test('« Aucun » est coche tant qu\'aucune persona n\'est active', () => {
    setup({ agents: AGENTS });
    expect(screen.getByRole('radio', { name: 'Aucun' })).toHaveAttribute('aria-checked', 'true');
  });

  test('choisir une persona la remonte au parent et force le mode agent', () => {
    const { onActiveAgentChange, onExecutionModeChange } = setup({
      agents: AGENTS,
      executionMode: 'ask'
    });

    fireEvent.click(screen.getByRole('radio', { name: /reviewer/ }));

    expect(onActiveAgentChange).toHaveBeenCalledWith(AGENTS[0]);
    expect(onExecutionModeChange).toHaveBeenCalledWith('agent');
  });

  test('en mode agent deja actif, choisir une persona ne re-emet pas le mode', () => {
    const { onExecutionModeChange } = setup({ agents: AGENTS, executionMode: 'agent' });

    fireEvent.click(screen.getByRole('radio', { name: /tester/ }));

    expect(onExecutionModeChange).not.toHaveBeenCalled();
  });

  test('choisir un mode d\'execution desactive la persona courante', () => {
    const { onActiveAgentChange, onExecutionModeChange } = setup({
      agents: AGENTS,
      activeAgent: AGENTS[0]
    });

    fireEvent.click(screen.getByRole('radio', { name: /Plan/ }));

    expect(onExecutionModeChange).toHaveBeenCalledWith('plan');
    expect(onActiveAgentChange).toHaveBeenCalledWith(null);
  });

  test('une persona active decoche tous les segments de mode', () => {
    setup({ agents: AGENTS, activeAgent: AGENTS[1], executionMode: 'agent' });

    const modeGroup = screen.getByRole('radiogroup', { name: "Mode d'exécution" });
    within(modeGroup)
      .getAllByRole('radio')
      .forEach((radio) => expect(radio).toHaveAttribute('aria-checked', 'false'));
    expect(screen.getByRole('radio', { name: /tester/ })).toHaveAttribute('aria-checked', 'true');
  });

  test('le mode courant reste atteignable au clavier malgre une persona active', () => {
    setup({ agents: AGENTS, activeAgent: AGENTS[0], executionMode: 'agent' });

    // Roving tabindex : exactement un segment de mode a tabIndex 0.
    const modeGroup = screen.getByRole('radiogroup', { name: "Mode d'exécution" });
    const focusables = within(modeGroup)
      .getAllByRole('radio')
      .filter((r) => r.getAttribute('tabindex') === '0');
    expect(focusables).toHaveLength(1);
    expect(focusables[0]).toHaveTextContent('Agent');
  });

  test('les fleches naviguent entre personas et emettent la selection', () => {
    const { onActiveAgentChange } = setup({ agents: AGENTS });

    const none = screen.getByRole('radio', { name: 'Aucun' });
    none.focus();
    fireEvent.keyDown(none, { key: 'ArrowRight' });

    expect(onActiveAgentChange).toHaveBeenCalledWith(AGENTS[0]);
  });

  test('« Gérer les agents » n\'est rendu qu\'avec un handler', () => {
    const onOpenAgentManager = jest.fn();
    const { unmount } = render(
      <AutonomyControls
        executionMode="agent"
        onExecutionModeChange={jest.fn()}
        autonomyLevel="normal"
        onAutonomyLevelChange={jest.fn()}
        agents={AGENTS}
      />
    );
    expect(screen.queryByRole('button', { name: 'Gérer les agents' })).not.toBeInTheDocument();
    unmount();

    render(
      <AutonomyControls
        executionMode="agent"
        onExecutionModeChange={jest.fn()}
        autonomyLevel="normal"
        onAutonomyLevelChange={jest.fn()}
        agents={AGENTS}
        onOpenAgentManager={onOpenAgentManager}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Gérer les agents' }));
    expect(onOpenAgentManager).toHaveBeenCalled();
  });

  test('disabled desactive aussi les controles de persona', () => {
    setup({ agents: AGENTS, disabled: true, onOpenAgentManager: jest.fn() });

    expect(screen.getByRole('radio', { name: 'Aucun' })).toBeDisabled();
    expect(screen.getByRole('radio', { name: /reviewer/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Gérer les agents' })).toBeDisabled();
  });
});
