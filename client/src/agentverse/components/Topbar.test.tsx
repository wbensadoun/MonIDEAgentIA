import { fireEvent, render, screen } from '@testing-library/react';
import { Topbar } from './Topbar';
import { THEMES } from '../data/themes';

describe('AgentVerse scene switcher', () => {
  it('exposes the active scene and changes it through a native keyboard-accessible button', () => {
    const onThemeChange = jest.fn();

    render(
      <Topbar
        theme={THEMES.town}
        kpis={{ shipped: 1, goal: 3, bugs: 0, completion: 33 }}
        live={false}
        onThemeChange={onThemeChange}
      />,
    );

    const town = screen.getByRole('button', { name: 'Choisir la scène Monster Town' });
    const cyber = screen.getByRole('button', { name: 'Choisir la scène Cyber Deck' });
    expect(town).toHaveAttribute('aria-pressed', 'true');
    expect(cyber).toHaveAttribute('aria-pressed', 'false');

    cyber.focus();
    fireEvent.keyDown(cyber, { key: 'Enter' });
    expect(onThemeChange).toHaveBeenCalledWith('cyberpunk');
  });
});
