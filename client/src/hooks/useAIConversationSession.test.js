import { act, renderHook } from '@testing-library/react';
import useAIConversationSession from './useAIConversationSession';
import { createChatTab, isSameTab } from '../utils/tabs';

// plan-ia-onglets.md §⑤ 5.5 — sessions[] + activeSessionId replace the old
// flat aiConversationHistory. The guarantee this file exists to prove above
// all others (5.5.3): closing a chat TAB never deletes the underlying
// SESSION. Tabs (openTabs, owned by App.js/useEditorSession) and sessions
// (owned by this hook) are deliberately separate pieces of state — a "close
// tab" action that only ever touches openTabs cannot lose a session no
// matter what it does, which is exactly what's asserted below instead of
// re-implementing App.js's handlers.

const buildDeps = (overrides = {}) => ({
  currentProjectPath: 'C:/project',
  isElectronApiAvailable: false,
  showMessage: jest.fn(),
  aiProvider: 'gemini',
  abortController: null,
  setAbortController: jest.fn(),
  resetPendingChangesState: jest.fn(),
  resetContextEstimate: jest.fn(),
  resetMultiAIState: jest.fn(),
  ...overrides
});

beforeEach(() => {
  localStorage.clear();
});

test('starts with a single default session that is active', () => {
  const { result } = renderHook(() => useAIConversationSession(buildDeps()));

  expect(result.current.sessions).toHaveLength(1);
  expect(result.current.activeSessionId).toBe(result.current.sessions[0].id);
  expect(result.current.aiConversationHistory).toEqual([]);
});

test('setAiConversationHistory writes into the active session and derives its title from the first user message', () => {
  const { result } = renderHook(() => useAIConversationSession(buildDeps()));

  act(() => {
    result.current.setAiConversationHistory((prev) => [...prev, { role: 'user', text: 'Explique-moi ce bug de layout' }]);
  });

  expect(result.current.aiConversationHistory).toEqual([
    { role: 'user', text: 'Explique-moi ce bug de layout' }
  ]);
  expect(result.current.sessions).toHaveLength(1);
  expect(result.current.sessions[0].title).toBe('Explique-moi ce bug de layout');
});

test('startNewConversation creates a real new session and keeps the previous one intact', () => {
  const { result } = renderHook(() => useAIConversationSession(buildDeps()));

  act(() => {
    result.current.setAiConversationHistory([{ role: 'user', text: 'Premiere session' }]);
  });
  const firstSessionId = result.current.activeSessionId;

  act(() => {
    result.current.startNewConversation();
  });

  expect(result.current.sessions).toHaveLength(2);
  expect(result.current.activeSessionId).not.toBe(firstSessionId);
  expect(result.current.aiConversationHistory).toEqual([]);

  const firstSession = result.current.sessions.find((s) => s.id === firstSessionId);
  expect(firstSession).toBeDefined();
  expect(firstSession.messages).toEqual([{ role: 'user', text: 'Premiere session' }]);
});

// ─── La garantie critique de l'etape ⑤ (5.5.3) ─────────────────────────────
// "Fermer un onglet chat (le x) -> la session RESTE en historique. Ce n'est
// PAS une suppression." Seul le bouton Supprimer (deleteSession, apres
// confirmation) efface une session.
test('closing a chat tab does not delete the session: it stays in history with its messages and can be reopened', () => {
  const { result } = renderHook(() => useAIConversationSession(buildDeps()));

  act(() => {
    result.current.setAiConversationHistory([
      { role: 'user', text: 'Ne perds pas ce message' },
      { role: 'model', text: 'Promis.' }
    ]);
  });
  const sessionId = result.current.activeSessionId;
  const sessionsBeforeClose = result.current.sessions;

  // Simule le cycle de vie App.js d'un onglet de chat : ouvrir ajoute un Tab
  // { type: 'chat', sessionId } a openTabs (un etat totalement distinct de
  // `sessions`), fermer le retire de openTabs. Ni l'un ni l'autre n'appelle
  // jamais deleteSession — la fonction n'existe meme pas dans ce scope.
  let openTabs = [];
  const openChatTab = (id) => {
    const tab = createChatTab(id);
    openTabs = openTabs.some((t) => isSameTab(t, tab)) ? openTabs : [...openTabs, tab];
  };
  const closeChatTab = (id) => {
    openTabs = openTabs.filter((t) => !(t.type === 'chat' && t.sessionId === id));
  };

  openChatTab(sessionId);
  expect(openTabs).toEqual([{ type: 'chat', sessionId }]);

  closeChatTab(sessionId);
  expect(openTabs).toEqual([]);

  // La session n'a absolument pas bouge dans le modele : meme reference de
  // tableau (aucun setSessions n'a ete declenche par la fermeture d'onglet).
  expect(result.current.sessions).toBe(sessionsBeforeClose);
  const session = result.current.sessions.find((s) => s.id === sessionId);
  expect(session).toBeDefined();
  expect(session.messages).toEqual([
    { role: 'user', text: 'Ne perds pas ce message' },
    { role: 'model', text: 'Promis.' }
  ]);

  // Rouvrable : ouvrir a nouveau le meme sessionId recree le meme onglet
  // (regle d'identite, §2) avec le meme contenu, rien n'a ete perdu.
  openChatTab(sessionId);
  expect(openTabs).toEqual([{ type: 'chat', sessionId }]);
  expect(result.current.sessions.find((s) => s.id === sessionId).messages).toHaveLength(2);
});

test('by contrast, deleteSession actually removes the session (only reachable via explicit confirmation in the UI)', () => {
  const { result } = renderHook(() => useAIConversationSession(buildDeps()));

  act(() => {
    result.current.setAiConversationHistory([{ role: 'user', text: 'A supprimer' }]);
  });
  const sessionId = result.current.activeSessionId;

  act(() => {
    result.current.startNewConversation();
  });
  expect(result.current.sessions).toHaveLength(2);

  act(() => {
    result.current.deleteSession(sessionId);
  });

  expect(result.current.sessions.find((s) => s.id === sessionId)).toBeUndefined();
  expect(result.current.sessions).toHaveLength(1);
});

test('deleteSession never leaves the panel without a session: deleting the last one creates a fresh empty session', () => {
  const { result } = renderHook(() => useAIConversationSession(buildDeps()));
  const onlySessionId = result.current.activeSessionId;

  act(() => {
    result.current.deleteSession(onlySessionId);
  });

  expect(result.current.sessions).toHaveLength(1);
  expect(result.current.sessions[0].id).not.toBe(onlySessionId);
  expect(result.current.activeSessionId).toBe(result.current.sessions[0].id);
});

test('switchSession changes which session is active without touching any session data', () => {
  const { result } = renderHook(() => useAIConversationSession(buildDeps()));

  act(() => {
    result.current.setAiConversationHistory([{ role: 'user', text: 'Session A' }]);
  });
  const sessionAId = result.current.activeSessionId;

  act(() => {
    result.current.startNewConversation();
  });
  act(() => {
    result.current.setAiConversationHistory([{ role: 'user', text: 'Session B' }]);
  });
  const sessionBId = result.current.activeSessionId;

  act(() => {
    result.current.switchSession(sessionAId);
  });

  expect(result.current.activeSessionId).toBe(sessionAId);
  expect(result.current.aiConversationHistory).toEqual([{ role: 'user', text: 'Session A' }]);
  expect(result.current.sessions.find((s) => s.id === sessionBId).messages).toEqual([
    { role: 'user', text: 'Session B' }
  ]);
});

test('renameSession overrides the auto-derived title explicitly (the "Renommer" context-menu action)', () => {
  const { result } = renderHook(() => useAIConversationSession(buildDeps()));

  act(() => {
    result.current.setAiConversationHistory([{ role: 'user', text: 'titre original' }]);
  });
  const sessionId = result.current.activeSessionId;

  act(() => {
    result.current.renameSession(sessionId, 'Mon titre a moi');
  });

  expect(result.current.sessions.find((s) => s.id === sessionId).title).toBe('Mon titre a moi');
});

test('duplicateSession copies the messages into a new, independent session', () => {
  const { result } = renderHook(() => useAIConversationSession(buildDeps()));

  act(() => {
    result.current.setAiConversationHistory([{ role: 'user', text: 'original' }]);
  });
  const originalId = result.current.activeSessionId;

  let copyId;
  act(() => {
    copyId = result.current.duplicateSession(originalId);
  });

  expect(result.current.sessions).toHaveLength(2);
  const copy = result.current.sessions.find((s) => s.id === copyId);
  expect(copy.messages).toEqual([{ role: 'user', text: 'original' }]);
  expect(copy.id).not.toBe(originalId);

  // Independant : modifier l'original ne doit pas modifier la copie.
  act(() => {
    result.current.setAiConversationHistory((prev) => [...prev, { role: 'model', text: 'reponse' }]);
  });
  expect(result.current.sessions.find((s) => s.id === copyId).messages).toHaveLength(1);
});
