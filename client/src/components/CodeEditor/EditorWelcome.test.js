import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import EditorWelcome from './EditorWelcome';

describe('EditorWelcome', () => {
  it('renders welcome screen with shortcuts', () => {
    render(<EditorWelcome projectName="test-project" />);
    
    expect(screen.getByText('test-project')).toBeInTheDocument();
    expect(screen.getByText("Ouvrez un fichier pour commencer, ou utilisez un raccourci.")).toBeInTheDocument();
    
    expect(screen.getByText('Ouvrir un fichier')).toBeInTheDocument();
    expect(screen.getByText('Palette de commandes')).toBeInTheDocument();
    expect(screen.getByText('Basculer le terminal')).toBeInTheDocument();
    expect(screen.getByText('Recherche globale')).toBeInTheDocument();
  });

  it('renders with default project name when none provided', () => {
    render(<EditorWelcome />);
    
    expect(screen.getByText('Code Companion')).toBeInTheDocument();
  });
});