/**
 * COD-70 — comportements du composer legacy (AIChat/index.js) :
 *   1. IME : Enter pendant une composition n'envoie pas
 *   2. Suggestions @fichier : ouverture, navigation clavier (ArrowDown/Enter),
 *      fermeture Escape, ARIA listbox/option + aria-activedescendant
 *   3. Édition non-destructive d'un message user (Modifier -> textarea -> Enter
 *      renvoie le texte edite via onSend)
 *   4. Feedback 👍/👎 (aria-pressed toggle)
 *   5. Fenetre glissante : bouton "plus anciens" au-dela de la fenetre,
 *      absent en dessous
 *
 * Le legacy est monte avec le flag chatInterfaceSwap OFF (defaut) pour
 * exercer le chemin de production reel (render par map() avec index absolus).
 */
import React, { useState } from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';

import AIChat from '../index';

// Harness controle : AIChat est un composant pilote par ses props prompt/
// conversationHistory ; on rejoue le role de App.js/useAI.
const Harness = ({
  initialPrompt = '',
  history = [],
  onSend = jest.fn(),
  onPromptChange = jest.fn(),
  projectFileList = ['src/a.js', 'src/b.js'],
  ...rest
}) => {
  const [prompt, setPrompt] = useState(initialPrompt);
  return (
    <AIChat
      prompt={prompt}
      conversationHistory={history}
      isLoading={false}
      currentProjectPath="/tmp/proj"
      isElectronApiAvailable
      onPromptChange={(next) => {
        setPrompt(next);
        onPromptChange(next);
      }}
      onSend={onSend}
      onSaveConversation={jest.fn()}
      onPasteImage={jest.fn()}
      multiAIState={{ isActive: false }}
      isSwarmPanelOpen={false}
      onToggleSwarmPanel={jest.fn()}
      conversations={[]}
      activeConversationFile={null}
      isConversationLoading={false}
      onNewConversation={jest.fn()}
      onSelectConversation={jest.fn()}
      onStopGeneration={jest.fn()}
      sessions={[]}
      activeSessionId={null}
      workflows={[]}
      getWorkflow={jest.fn()}
      parseSlashCommand={null}
      activeFile={null}
      onProviderChange={jest.fn()}
      aiProvider="gemini"
      executionMode="agent"
      onExecutionModeChange={jest.fn()}
      autoRoute={false}
      onAutoRouteChange={jest.fn()}
      routerDecision={null}
      agents={[]}
      activeAgent={null}
      onActiveAgentChange={jest.fn()}
      onOpenAgentManager={jest.fn()}
      activeModelValue=""
      availableActiveModels={[]}
      onActiveModelChange={jest.fn()}
      pendingImages={[]}
      onRemovePendingImage={jest.fn()}
      pendingMessage={null}
      projectFileList={projectFileList}
      pendingFileChanges={[]}
      permissionMode="edit_terminal"
      {...rest}
    />
  );
};

describe('COD-70 composer — IME guard', () => {
  test('Enter pendant une composition IME (isComposing) n\'envoie pas', () => {
    const onSend = jest.fn();
    render(<Harness initialPrompt="bonjour" onSend={onSend} />);
    const textarea = screen.getByRole('combobox');
    fireEvent.keyDown(textarea, { key: 'Enter', isComposing: true });
    expect(onSend).not.toHaveBeenCalled();
    fireEvent.keyDown(textarea, { key: 'Enter', isComposing: false });
    expect(onSend).toHaveBeenCalledTimes(1);
  });
});

describe('COD-70 composer — suggestions @fichier au clavier', () => {
  test('@ ouvre une listbox ARIA, ArrowDown+Enter selectionne, Escape ferme', () => {
    const onSend = jest.fn();
    render(<Harness onSend={onSend} />);
    const textarea = screen.getByRole('combobox');

    fireEvent.change(textarea, { target: { value: '@' } });

    const listbox = screen.getByRole('listbox', { name: 'Fichiers du projet' });
    const options = within(listbox).getAllByRole('option');
    expect(options).toHaveLength(2);
    // 1re option preselectionnee + aria-activedescendant aligne.
    expect(options[0]).toHaveAttribute('aria-selected', 'true');
    expect(textarea).toHaveAttribute('aria-activedescendant', options[0].id);

    fireEvent.keyDown(textarea, { key: 'ArrowDown' });
    expect(options[1]).toHaveAttribute('aria-selected', 'true');
    expect(textarea).toHaveAttribute('aria-activedescendant', options[1].id);

    fireEvent.keyDown(textarea, { key: 'Enter' });
    // Enter sur une suggestion selectionnee ne doit PAS envoyer le message.
    expect(onSend).not.toHaveBeenCalled();
    // Le fichier est ajoute comme pill de contexte retirables au clavier.
    expect(
      screen.getByRole('button', { name: 'Retirer b.js du contexte' })
    ).toBeInTheDocument();
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();

    // Retour a la saisie : Escape ferme sans selectionner.
    fireEvent.change(textarea, { target: { value: '@a' } });
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    fireEvent.keyDown(textarea, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });
});

describe('COD-68 — lignes de chat sémantiques', () => {
  test('une conversation sauvegardée est activable comme bouton', () => {
    const onSelectConversation = jest.fn();
    render(
      <Harness
        conversations={[{ fileName: 'saved.json', title: 'Sauvegardée', createdAt: '2026-09-01T00:00:00Z' }]}
        onSelectConversation={onSelectConversation}
      />
    );

    fireEvent.click(screen.getByTitle('Historique'));
    const conversation = screen.getByRole('button', { name: /Sauvegardée/ });
    fireEvent.click(conversation);

    expect(onSelectConversation).toHaveBeenCalledWith('saved.json');
  });

  test('le chemin d’un changement en attente est activable séparément des actions', () => {
    const onSelectPendingChange = jest.fn();
    render(
      <Harness
        pendingFileChanges={[{ id: 'change-1', filePath: 'src/app.js' }]}
        onSelectPendingChange={onSelectPendingChange}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'src/app.js' }));

    expect(onSelectPendingChange).toHaveBeenCalledWith(0);
  });
});

describe('COD-70 — actions sur les messages', () => {
  test('Modifier un message user -> edition inline -> Enter renvoie le texte edite', () => {
    const onSend = jest.fn();
    render(
      <Harness
        history={[{ id: 'u1', role: 'user', text: 'salut' }]}
        onSend={onSend}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Modifier et renvoyer' }));
    const edit = screen.getByLabelText('Modifier le message');
    fireEvent.change(edit, { target: { value: 'salut, en vrai' } });
    fireEvent.keyDown(edit, { key: 'Enter' });
    expect(onSend).toHaveBeenCalledWith('salut, en vrai');
    expect(screen.queryByLabelText('Modifier le message')).not.toBeInTheDocument();
  });

  test('Echap annule l\'edition sans envoyer', () => {
    const onSend = jest.fn();
    render(
      <Harness history={[{ id: 'u1', role: 'user', text: 'salut' }]} onSend={onSend} />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Modifier et renvoyer' }));
    const edit = screen.getByLabelText('Modifier le message');
    fireEvent.change(edit, { target: { value: 'changement' } });
    fireEvent.keyDown(edit, { key: 'Escape' });
    expect(onSend).not.toHaveBeenCalled();
    expect(screen.queryByLabelText('Modifier le message')).not.toBeInTheDocument();
  });

  test('👍/👎 sur la reponse de l\'agent : toggle aria-pressed', () => {
    render(
      <Harness history={[{ id: 'm1', role: 'model', text: 'voila' }]} />
    );
    const up = screen.getByRole('button', { name: 'Réponse utile' });
    const down = screen.getByRole('button', { name: 'Réponse peu utile' });
    expect(up).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(up);
    expect(up).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(up);
    expect(up).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(down);
    expect(down).toHaveAttribute('aria-pressed', 'true');
    // Pouce exclusif : cliquer l'autre bascule.
    expect(up).toHaveAttribute('aria-pressed', 'false');
  });

  test('Copier est disponible sur les messages user comme assistant', () => {
    render(
      <Harness
        history={[
          { id: 'u1', role: 'user', text: 'question' },
          { id: 'm1', role: 'model', text: 'reponse' }
        ]}
      />
    );
    const userCopy = screen.getByRole('button', { name: 'Copier le message' });
    const assistantCopy = screen.getByRole('button', { name: 'Copier la réponse' });
    expect(userCopy).toBeInTheDocument();
    expect(assistantCopy).toBeInTheDocument();
  });
});

describe('COD-70 — fenetre glissante (B.11)', () => {
  const makeHistory = (n) =>
    Array.from({ length: n }, (_, i) => ({ id: `m${i}`, role: 'model', text: `msg ${i}` }));

  test('bouton "plus anciens" absent sous la fenetre, present au-dessus', () => {
    const { unmount } = render(<Harness history={makeHistory(10)} />);
    expect(screen.queryByText(/plus anciens/)).not.toBeInTheDocument();
    unmount();

    render(<Harness history={makeHistory(60)} />);
    const earlier = screen.getByText(/Afficher 10 messages plus anciens/);
    fireEvent.click(earlier);
    // Apres revelation, tous les messages sont dans le DOM et le bouton disparait.
    expect(screen.queryByText(/plus anciens/)).not.toBeInTheDocument();
    expect(screen.getByText('msg 0')).toBeInTheDocument();
    expect(screen.getByText('msg 59')).toBeInTheDocument();
  });
});

describe('COD-70 — swap ChatInterface garde la parite du composer', () => {
  beforeEach(() => window.localStorage.setItem('cc.flag.chatInterfaceSwap', '1'));
  afterEach(() => window.localStorage.clear());

  test('le flag monte ChatInterface et conserve edition, feedback et suggestions', () => {
    render(
      <Harness
        history={[
          { id: 'u1', role: 'user', text: 'salut' },
          { id: 'm1', role: 'model', text: 'voila' }
        ]}
      />
    );

    expect(document.querySelector('.chat-interface')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Modifier et renvoyer' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Réponse utile' })).toBeInTheDocument();

    const textarea = screen.getByRole('combobox');
    fireEvent.change(textarea, { target: { value: '@' } });
    expect(screen.getByRole('listbox', { name: 'Fichiers du projet' })).toBeInTheDocument();
  });
});
