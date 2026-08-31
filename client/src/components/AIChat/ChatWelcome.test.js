import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import ChatWelcome from './ChatWelcome';

describe('ChatWelcome', () => {
  const mockOnPickSuggestion = jest.fn();

  beforeEach(() => {
    mockOnPickSuggestion.mockClear();
  });

  it('renders welcome screen with suggestions', () => {
    render(<ChatWelcome onPickSuggestion={mockOnPickSuggestion} />);
    
    expect(screen.getByText('Code Companion')).toBeInTheDocument();
    expect(screen.getByText("Votre copilote IA. Posez une question ou choisissez un point de départ.")).toBeInTheDocument();
    
    expect(screen.getByText('Expliquer ce projet')).toBeInTheDocument();
    expect(screen.getByText('Écrire du code')).toBeInTheDocument();
    expect(screen.getByText('Trouver un bug')).toBeInTheDocument();
    expect(screen.getByText('Refactoriser')).toBeInTheDocument();
    expect(screen.getByText('Revue de sécurité')).toBeInTheDocument();
    expect(screen.getByText('Ajouter des tests')).toBeInTheDocument();
  });

  it('calls onPickSuggestion when a suggestion is clicked', () => {
    render(<ChatWelcome onPickSuggestion={mockOnPickSuggestion} />);
    
    const suggestion = screen.getByText('Expliquer ce projet');
    fireEvent.click(suggestion);
    
    expect(mockOnPickSuggestion).toHaveBeenCalledWith('Explique-moi la structure de ce projet et son objectif principal.');
  });
});