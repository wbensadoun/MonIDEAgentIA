/**
 * 1.4a — MessageViewer rend le Markdown des messages termines.
 *
 * Avant ce lot, les blocs `text` etaient rendus en `<p>{content}</p>` litteral :
 * un message contenant `## Titre` ou `- item` s'affichait avec ses caracteres
 * de balisage. Ces tests verrouillent le branchement de MarkdownRenderer, et
 * surtout la frontiere volontaire : messages termines = Markdown, bulle de
 * streaming = texte brut (region aria-live, cf. commentaire dans le composant).
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import MessageViewer, { ChatMessage } from '../MessageViewer';

const message = (blocks: ChatMessage['blocks'], id = 'm1'): ChatMessage => ({
  id,
  role: 'assistant',
  blocks,
  timestamp: 1735689600000
});

describe('MessageViewer — rendu Markdown des messages termines', () => {
  test('un titre Markdown devient un vrai heading, pas du texte litteral', () => {
    render(<MessageViewer messages={[message([{ type: 'text', content: '## Resultat' }])]} />);

    const heading = screen.getByRole('heading', { level: 2 });
    expect(heading).toHaveTextContent('Resultat');
    // Le marqueur ne doit plus apparaitre tel quel.
    expect(screen.queryByText('## Resultat')).not.toBeInTheDocument();
  });

  test('une liste Markdown devient une vraie liste', () => {
    render(
      <MessageViewer
        messages={[message([{ type: 'text', content: '- premier\n- second' }])]}
      />
    );

    expect(screen.getByRole('list')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
  });

  test('le gras et le code inline sont interpretes', () => {
    render(
      <MessageViewer
        messages={[message([{ type: 'text', content: 'Fichier **critique** dans `App.js`' }])]}
      />
    );

    expect(screen.getByText('critique').tagName).toBe('STRONG');
    expect(screen.getByText('App.js').tagName).toBe('CODE');
  });

  test('un lien Markdown est rendu avec rel de securite', () => {
    render(
      <MessageViewer
        messages={[message([{ type: 'text', content: '[docs](https://example.com)' }])]}
      />
    );

    const link = screen.getByRole('link', { name: 'docs' });
    expect(link).toHaveAttribute('href', 'https://example.com');
    // Ouverture en nouvel onglet sans exposer window.opener.
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
  });

  test('le texte simple reste intact et n\'est pas mange par le parseur', () => {
    render(
      <MessageViewer
        messages={[message([{ type: 'text', content: 'Une phrase sans balisage.' }])]}
      />
    );

    expect(screen.getByText('Une phrase sans balisage.')).toBeInTheDocument();
  });

  test('les blocs `code` continuent de passer par CodeBlock, pas par Markdown', () => {
    render(
      <MessageViewer
        messages={[
          message([{ type: 'code', content: 'const a = 1;', language: 'js', filename: 'a.js' }])
        ]}
      />
    );

    // CodeBlock affiche le nom de fichier ; MarkdownRenderer ne le ferait pas.
    expect(screen.getByText('a.js')).toBeInTheDocument();
  });
});

describe('MessageViewer — la bulle de streaming reste en texte brut', () => {
  test('le balisage Markdown n\'est PAS interprete pendant le streaming', () => {
    render(<MessageViewer messages={[]} isStreaming streamingText="## Encore en cours" />);

    const live = screen.getByLabelText('Messages streaming');
    // Le texte est present...
    expect(live).toHaveTextContent('## Encore en cours');
    // ...mais aucun heading n'a ete cree : le rendu reste un noeud texte, ce qui
    // preserve l'annonce incrementale du lecteur d'ecran.
    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
  });

  test('la region de streaming reste aria-live polite apres le branchement', () => {
    render(<MessageViewer messages={[]} isStreaming streamingText="partiel" />);

    const live = screen.getByLabelText('Messages streaming');
    expect(live).toHaveAttribute('aria-live', 'polite');
    expect(live).toHaveAttribute('aria-atomic', 'false');
  });
});

describe('MessageViewer — passe-plat vers les actions de bloc de code', () => {
  test('onApplyCode alimente le bouton « Appliquer » d\'un bloc marque FICHIER', () => {
    const onApplyCode = jest.fn();
    render(
      <MessageViewer
        messages={[
          message([
            {
              type: 'text',
              content: '**FICHIER: src/App.js**\n```js\nconst a = 1;\n```'
            }
          ])
        ]}
        onApplyCode={onApplyCode}
      />
    );

    // Le bouton n'existe que si onApply ET filePath sont fournis : sa presence
    // prouve que le marqueur a ete associe au bloc et le callback transmis.
    expect(screen.getByRole('button', { name: /Appliquer/ })).toBeInTheDocument();
  });

  test('sans onApplyCode, aucun bouton « Appliquer » n\'est rendu', () => {
    render(
      <MessageViewer
        messages={[
          message([
            {
              type: 'text',
              content: '**FICHIER: src/App.js**\n```js\nconst a = 1;\n```'
            }
          ])
        ]}
      />
    );

    expect(screen.queryByRole('button', { name: /Appliquer/ })).not.toBeInTheDocument();
  });
});
