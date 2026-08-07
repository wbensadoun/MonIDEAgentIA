/**
 * 1.4c — MessageViewer doit couvrir tout le perimetre de la boucle de rendu
 * d'index.js avant qu'un swap soit envisageable. Ces tests verrouillent les
 * trois types de blocs qui manquaient (plain / reasoning / empty) et les
 * actions par message : chacun correspond a un comportement production dont
 * la perte serait une regression silencieuse.
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import MessageViewer, { ChatMessage } from '../MessageViewer';

const assistant = (blocks: ChatMessage['blocks']): ChatMessage => ({
  id: 'a1',
  role: 'assistant',
  blocks,
  timestamp: 1735689600000
});

describe('MessageViewer — types de blocs', () => {
  test('un bloc `plain` n\'est pas interprete comme du Markdown', () => {
    render(
      <MessageViewer
        messages={[
          { id: 'u1', role: 'user', timestamp: 0, blocks: [{ type: 'plain', content: '## pas un titre **gras**' }] }
        ]}
      />
    );

    expect(screen.getByText('## pas un titre **gras**')).toBeInTheDocument();
    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
  });

  test('un bloc `reasoning` est rendu replie', () => {
    const { container } = render(
      <MessageViewer messages={[assistant([{ type: 'reasoning', content: 'je reflechis' }])]} />
    );

    const details = container.querySelector('details.ai-reasoning') as HTMLDetailsElement;
    expect(details).toBeInTheDocument();
    expect(details.open).toBe(false);
    expect(screen.getByText('Raisonnement du modèle')).toBeInTheDocument();
    expect(screen.getByText('je reflechis')).toBeInTheDocument();
  });

  test('un bloc `empty` affiche l\'avertissement au lieu d\'une bulle blanche', () => {
    render(<MessageViewer messages={[assistant([{ type: 'empty', content: '' }])]} />);
    expect(screen.getByText(/réponse vide/)).toBeInTheDocument();
  });

  test('raisonnement et reponse coexistent dans l\'ordre d\'origine', () => {
    const { container } = render(
      <MessageViewer
        messages={[
          assistant([
            { type: 'text', content: 'Avant' },
            { type: 'reasoning', content: 'milieu' },
            { type: 'text', content: 'Apres' }
          ])
        ]}
      />
    );

    const body = container.querySelector('.message-viewer__bubble-content') as HTMLElement;
    expect(body.textContent).toContain('Avant');
    expect(body.textContent).toContain('Apres');
    expect(body.querySelector('details.ai-reasoning')).toBeInTheDocument();
  });
});

describe('MessageViewer — actions par message', () => {
  const message = assistant([{ type: 'text', content: 'reponse' }]);

  test('sans handler, aucun bouton d\'action n\'est rendu', () => {
    render(<MessageViewer messages={[message]} />);
    expect(screen.queryByLabelText('Copier la réponse')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Relancer cette requête')).not.toBeInTheDocument();
  });

  test('copier remonte le message complet au parent', () => {
    const onCopyMessage = jest.fn();
    render(<MessageViewer messages={[message]} onCopyMessage={onCopyMessage} />);

    fireEvent.click(screen.getByLabelText('Copier la réponse'));
    expect(onCopyMessage).toHaveBeenCalledWith(message);
  });

  test('relancer remonte le message et respecte actionsDisabled', () => {
    const onRerunMessage = jest.fn();
    const { rerender } = render(
      <MessageViewer messages={[message]} onRerunMessage={onRerunMessage} />
    );

    fireEvent.click(screen.getByLabelText('Relancer cette requête'));
    expect(onRerunMessage).toHaveBeenCalledWith(message);

    rerender(<MessageViewer messages={[message]} onRerunMessage={onRerunMessage} actionsDisabled />);
    expect(screen.getByLabelText('Relancer cette requête')).toBeDisabled();
  });

  test('les messages utilisateur et systeme n\'ont pas d\'actions', () => {
    render(
      <MessageViewer
        messages={[
          { id: 'u1', role: 'user', timestamp: 0, blocks: [{ type: 'plain', content: 'question' }] },
          { id: 's1', role: 'system', timestamp: 0, blocks: [{ type: 'text', content: 'Modification acceptee.' }] }
        ]}
        onCopyMessage={jest.fn()}
        onRerunMessage={jest.fn()}
      />
    );

    expect(screen.queryByLabelText('Copier la réponse')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Relancer cette requête')).not.toBeInTheDocument();
  });
});
