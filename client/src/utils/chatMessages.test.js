/**
 * 1.4c — l'adaptateur est le seul point du swap ou de la donnee peut se
 * perdre silencieusement. Ces tests verrouillent les trois garde-fous repris
 * de la boucle de rendu actuelle (raisonnement, reponse vide, badge agent).
 */
import {
  buildAgentLabel,
  conversationToChatMessages,
  normalizeRole,
  toChatMessage
} from './chatMessages';

describe('normalizeRole', () => {
  test('`model` (role emis par useAI) devient `assistant`', () => {
    expect(normalizeRole('model')).toBe('assistant');
  });

  test('user et system sont conserves', () => {
    expect(normalizeRole('user')).toBe('user');
    expect(normalizeRole('system')).toBe('system');
  });

  test('un role inconnu retombe sur assistant plutot que de disparaitre', () => {
    expect(normalizeRole(undefined)).toBe('assistant');
    expect(normalizeRole('tool')).toBe('assistant');
  });
});

describe('buildAgentLabel', () => {
  test('nom et provider deviennent un libelle neutre', () => {
    expect(buildAgentLabel({ agentName: 'reviewer', agentProvider: 'claude' })).toBe(
      'Assistant spécialisé'
    );
  });

  test('un seul des deux suffit sans exposer sa valeur', () => {
    expect(buildAgentLabel({ agentProvider: 'gemini' })).toBe('Assistant spécialisé');
    expect(buildAgentLabel({ agentName: 'reviewer' })).toBe('Assistant spécialisé');
  });

  test('sans rien a afficher, retourne undefined et pas une chaine vide', () => {
    expect(buildAgentLabel({})).toBeUndefined();
    expect(buildAgentLabel({ agentProvider: '   ' })).toBeUndefined();
  });
});

describe('toChatMessage', () => {
  test('un message assistant simple devient un bloc text', () => {
    const message = toChatMessage({ role: 'model', text: 'Bonjour' }, 0);
    expect(message.blocks).toEqual([{ type: 'text', content: 'Bonjour' }]);
    expect(message.role).toBe('assistant');
  });

  test('les segments <think> deviennent des blocs reasoning, pas du texte', () => {
    const message = toChatMessage(
      { role: 'model', text: 'Avant <think>je reflechis</think> Apres' },
      0
    );
    expect(message.blocks).toEqual([
      { type: 'text', content: 'Avant' },
      { type: 'reasoning', content: 'je reflechis' },
      { type: 'text', content: 'Apres' }
    ]);
  });

  test('un bloc <think> non ferme (generation coupee) reste du raisonnement', () => {
    const message = toChatMessage({ role: 'model', text: 'Avant <think>coupe ici' }, 0);
    expect(message.blocks).toContainEqual({ type: 'reasoning', content: 'coupe ici' });
    expect(message.blocks).not.toContainEqual({ type: 'text', content: 'coupe ici' });
  });

  test('une reponse assistant vide produit un bloc empty, pas une bulle blanche', () => {
    expect(toChatMessage({ role: 'model', text: '' }, 0).blocks).toEqual([
      { type: 'empty', content: '' }
    ]);
  });

  test('un message utilisateur vide ne produit aucun bloc d\'avertissement', () => {
    expect(toChatMessage({ role: 'user', text: '' }, 0).blocks).toEqual([]);
  });

  test('le texte utilisateur est marque `plain` pour echapper au Markdown', () => {
    const message = toChatMessage({ role: 'user', text: 'garde mes **asterisques**' }, 0);
    expect(message.blocks).toEqual([{ type: 'plain', content: 'garde mes **asterisques**' }]);
  });

  test('l\'id d\'origine est conserve, sinon un id stable est derive de l\'index', () => {
    expect(toChatMessage({ role: 'user', text: 'a', id: 'abc' }, 3).id).toBe('abc');
    expect(toChatMessage({ role: 'user', text: 'a' }, 3).id).toBe('msg-3');
  });

  test('sourceIndex pointe vers l\'entree brute pour les actions par message', () => {
    expect(toChatMessage({ role: 'model', text: 'a' }, 7).sourceIndex).toBe(7);
  });

  test('l\'horodatage injecte sert de repli, l\'entree gagne si elle en porte un', () => {
    expect(toChatMessage({ role: 'user', text: 'a' }, 0, 1234).timestamp).toBe(1234);
    expect(toChatMessage({ role: 'user', text: 'a', timestamp: 99 }, 0, 1234).timestamp).toBe(99);
  });
});

describe('conversationToChatMessages', () => {
  test('convertit tout l\'historique en preservant l\'ordre', () => {
    const messages = conversationToChatMessages([
      { role: 'user', text: 'question' },
      { role: 'model', text: 'reponse' },
      { role: 'system', text: 'Modification IA acceptee.' }
    ]);
    expect(messages.map((m) => m.role)).toEqual(['user', 'assistant', 'system']);
  });

  test('un historique absent ou invalide donne une liste vide, jamais une erreur', () => {
    expect(conversationToChatMessages(undefined)).toEqual([]);
    expect(conversationToChatMessages(null)).toEqual([]);
    expect(conversationToChatMessages('pas un tableau')).toEqual([]);
  });

  test('aucun message n\'est perdu, meme vide', () => {
    const history = [
      { role: 'user', text: 'a' },
      { role: 'model', text: '' },
      { role: 'model', text: '<think>seulement du raisonnement</think>' }
    ];
    expect(conversationToChatMessages(history)).toHaveLength(3);
  });
});
