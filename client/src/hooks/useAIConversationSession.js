import { useCallback, useEffect, useRef, useState } from 'react';

// plan-ia-onglets.md §⑤ 5.5.1 — sessions[] + activeSessionId replace the old
// single flat `aiConversationHistory`. `aiConversationHistory`/
// `setAiConversationHistory` are kept as a derived view of the active
// session's `messages` so the rest of the AI pipeline (useAI.js,
// aiProviderRequests.js) needs zero changes: they only ever read/write
// "the current conversation", which is now "the active session".
const DEFAULT_TITLE = 'Nouvelle conversation';
const TITLE_MAX_LENGTH = 60;
const STORAGE_PREFIX = 'code_companion_chatSessions:';

const genSessionId = () => `sess_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;

// Le titre est TOUJOURS dérivé du premier message utilisateur (tronqué) —
// jamais un champ saisi à la main (5.5.1). "Renommer" (5.5.3) reste une
// action explicite distincte : elle écrase ce titre par défaut à la demande.
const deriveTitleFromMessages = (messages) => {
  const firstUserMessage = (Array.isArray(messages) ? messages : [])
    .find((entry) => entry?.role === 'user' && String(entry.text || '').trim());
  if (!firstUserMessage) return DEFAULT_TITLE;
  const text = String(firstUserMessage.text).trim().replace(/\s+/g, ' ');
  return text.length > TITLE_MAX_LENGTH ? `${text.slice(0, TITLE_MAX_LENGTH)}…` : text;
};

const createEmptySession = () => {
  const now = Date.now();
  return {
    id: genSessionId(),
    title: DEFAULT_TITLE,
    messages: [],
    createdAt: now,
    updatedAt: now
  };
};

const loadPersistedSessions = (projectPath) => {
  if (!projectPath) return null;
  try {
    const raw = localStorage.getItem(`${STORAGE_PREFIX}${projectPath}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.sessions) || parsed.sessions.length === 0) return null;
    const sessions = parsed.sessions
      .filter((s) => s && typeof s.id === 'string')
      .map((s) => ({
        id: s.id,
        title: typeof s.title === 'string' && s.title.trim() ? s.title : DEFAULT_TITLE,
        messages: Array.isArray(s.messages) ? s.messages : [],
        createdAt: Number(s.createdAt) || Date.now(),
        updatedAt: Number(s.updatedAt) || Date.now()
      }));
    if (sessions.length === 0) return null;
    const activeSessionId = sessions.some((s) => s.id === parsed.activeSessionId)
      ? parsed.activeSessionId
      : sessions[0].id;
    return { sessions, activeSessionId };
  } catch {
    return null;
  }
};

const useAIConversationSession = ({
  currentProjectPath,
  isElectronApiAvailable,
  showMessage,
  aiProvider,
  abortController,
  setAbortController,
  resetPendingChangesState,
  resetContextEstimate,
  resetMultiAIState
}) => {
  const [prompt, setPrompt] = useState('');
  const [sessions, setSessions] = useState(() => [createEmptySession()]);
  const [activeSessionId, setActiveSessionId] = useState(() => sessions[0].id);
  const [conversations, setConversations] = useState([]);
  const [activeConversationFile, setActiveConversationFile] = useState(null);
  const [isConversationLoading, setIsConversationLoading] = useState(false);
  const [loadedProjectPath, setLoadedProjectPath] = useState(null);

  // Lu depuis des mises à jour fonctionnelles de setSessions : évite de
  // capturer un activeSessionId perimé dans les closures de callbacks async
  // (meme pattern que activeRunIdRef dans useAI.js).
  const activeSessionIdRef = useRef(activeSessionId);
  activeSessionIdRef.current = activeSessionId;

  // Une session par projet : au changement de projet, restaure depuis
  // localStorage ou repart d'une session vide plutôt que de garder celle du
  // projet précédent (même logique que useWorkspaceSessionLayout §③).
  useEffect(() => {
    setLoadedProjectPath(null);
    const persisted = loadPersistedSessions(currentProjectPath);
    if (persisted) {
      setSessions(persisted.sessions);
      setActiveSessionId(persisted.activeSessionId);
    } else {
      const fresh = createEmptySession();
      setSessions([fresh]);
      setActiveSessionId(fresh.id);
    }
    setLoadedProjectPath(currentProjectPath || null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentProjectPath]);

  useEffect(() => {
    if (!currentProjectPath || loadedProjectPath !== currentProjectPath) return;
    try {
      localStorage.setItem(
        `${STORAGE_PREFIX}${currentProjectPath}`,
        JSON.stringify({ sessions, activeSessionId })
      );
    } catch {
      // localStorage may be unavailable in hardened browser contexts.
    }
  }, [currentProjectPath, loadedProjectPath, sessions, activeSessionId]);

  const activeSession = sessions.find((s) => s.id === activeSessionId) || sessions[0] || null;
  const aiConversationHistory = activeSession ? activeSession.messages : [];

  // Vue dérivée compatible avec l'ancienne API plate : useAI.js l'appelle
  // avec un tableau ou avec un updater fonctionnel (prev => [...prev, x]),
  // exactement comme le setState React qu'elle remplace.
  const setAiConversationHistory = useCallback((updater) => {
    setSessions((prevSessions) => prevSessions.map((session) => {
      if (session.id !== activeSessionIdRef.current) return session;
      const nextMessages = typeof updater === 'function' ? updater(session.messages) : updater;
      const nextTitle = session.title === DEFAULT_TITLE
        ? deriveTitleFromMessages(nextMessages)
        : session.title;
      return { ...session, messages: nextMessages, title: nextTitle, updatedAt: Date.now() };
    }));
  }, []);

  const refreshConversations = useCallback(async () => {
    if (!currentProjectPath || !isElectronApiAvailable || !window.electronAPI?.listConversations) {
      setConversations([]);
      return;
    }

    try {
      const res = await window.electronAPI.listConversations(currentProjectPath);
      if (res?.success && Array.isArray(res.conversations)) {
        setConversations(res.conversations);
      } else {
        setConversations([]);
      }
    } catch {
      // silent refresh
    }
  }, [currentProjectPath, isElectronApiAvailable]);

  useEffect(() => {
    refreshConversations();
  }, [refreshConversations]);

  const autoSaveConversation = useCallback(async (history) => {
    if (!currentProjectPath || !window.electronAPI?.saveConversation) return;
    if (history.length < 4) return;

    try {
      const response = await window.electronAPI.saveConversation(currentProjectPath, history);
      if (response && response.success) {
        await refreshConversations();
      }
    } catch {
      // silent autosave
    }
  }, [currentProjectPath, refreshConversations]);

  const saveConversation = useCallback(async () => {
    if (!currentProjectPath || aiConversationHistory.length === 0) {
      showMessage("Aucune conversation à sauvegarder.", 3000);
      return;
    }

    try {
      const response = await window.electronAPI.saveConversation(currentProjectPath, aiConversationHistory);
      if (response.success) {
        showMessage(`Conversation sauvegardée: ${response.fileName}`, 4000);
        setActiveConversationFile(response.fileName || null);
        setAiConversationHistory((prev) => [...prev, {
          role: 'system',
          text: `Conversation sauvegardée dans: conversations/${response.fileName}`
        }]);
        await refreshConversations();
      } else {
        showMessage(`Erreur: ${response.error}`, 5000);
      }
    } catch (error) {
      showMessage(`Erreur: ${error.message}`, 5000);
    }
  }, [currentProjectPath, aiConversationHistory, showMessage, refreshConversations, setAiConversationHistory]);

  // Remplace startNewConversation (nom conservé pour tous les appelants
  // existants : App.js, useCommandCenter "new-conv", WorkspaceSidebar). Crée
  // désormais une VRAIE nouvelle session au lieu de vider l'unique
  // conversation — l'ancienne reste intacte dans `sessions`.
  const createSession = useCallback(() => {
    const fresh = createEmptySession();
    setSessions((prev) => [...prev, fresh]);
    setActiveSessionId(fresh.id);
    setPrompt('');
    resetPendingChangesState();
    resetContextEstimate(aiProvider);
    setActiveConversationFile(null);
    resetMultiAIState();
    if (abortController) {
      abortController.abort();
      setAbortController(null);
    }
    return fresh.id;
  }, [
    abortController,
    aiProvider,
    resetContextEstimate,
    resetMultiAIState,
    resetPendingChangesState,
    setAbortController
  ]);

  // Bascule la session ACTIVE DU PANNEAU (5.5.2/5.5.3). N'affecte jamais les
  // onglets de chat déjà ouverts : ils continuent de pointer sur leur propre
  // sessionId, indépendamment de ce que le panneau affiche.
  const switchSession = useCallback((sessionId) => {
    if (!sessionId || sessionId === activeSessionIdRef.current) return;
    if (!sessions.some((s) => s.id === sessionId)) return;
    setActiveSessionId(sessionId);
    setPrompt('');
    resetPendingChangesState();
    resetContextEstimate(aiProvider);
    setActiveConversationFile(null);
    resetMultiAIState();
    if (abortController) {
      abortController.abort();
      setAbortController(null);
    }
  }, [
    sessions,
    abortController,
    aiProvider,
    resetContextEstimate,
    resetMultiAIState,
    resetPendingChangesState,
    setAbortController
  ]);

  // "Renommer" (menu contextuel, 5.5.3) : seule façon d'écraser le titre
  // dérivé automatiquement. Une chaîne vide restaure la dérivation auto.
  const renameSession = useCallback((sessionId, title) => {
    const trimmed = String(title || '').trim();
    setSessions((prev) => prev.map((session) => {
      if (session.id !== sessionId) return session;
      return {
        ...session,
        title: trimmed || deriveTitleFromMessages(session.messages),
        updatedAt: Date.now()
      };
    }));
  }, []);

  const duplicateSession = useCallback((sessionId) => {
    const source = sessions.find((s) => s.id === sessionId);
    if (!source) return null;
    const now = Date.now();
    const copy = {
      id: genSessionId(),
      title: `${source.title} (copie)`,
      messages: source.messages.map((m) => ({ ...m })),
      createdAt: now,
      updatedAt: now
    };
    setSessions((prev) => [...prev, copy]);
    return copy.id;
  }, [sessions]);

  // Ne fait QUE retirer la session du modèle : ne touche à aucun onglet
  // ouvert. C'est à l'appelant (App.js, qui seul connaît openTabs) de fermer
  // l'onglet correspondant après confirmation (5.5.3 — "supprimer une
  // session ouverte en onglet: fermer l'onglet ET supprimer la session").
  const deleteSession = useCallback((sessionId) => {
    const remaining = sessions.filter((s) => s.id !== sessionId);
    if (remaining.length === 0) {
      const fresh = createEmptySession();
      setSessions([fresh]);
      setActiveSessionId(fresh.id);
      return;
    }
    setSessions(remaining);
    if (activeSessionIdRef.current === sessionId) {
      setActiveSessionId(remaining[remaining.length - 1].id);
    }
  }, [sessions]);

  const loadConversationByFile = useCallback(async (fileName) => {
    if (!fileName || !currentProjectPath || !isElectronApiAvailable || !window.electronAPI?.loadConversation) {
      return;
    }

    setIsConversationLoading(true);
    try {
      const res = await window.electronAPI.loadConversation(currentProjectPath, fileName);
      if (res?.success && Array.isArray(res.history)) {
        setAiConversationHistory(res.history);
        setPrompt('');
        resetPendingChangesState();
        setActiveConversationFile(fileName);
        resetMultiAIState();
        showMessage(`Conversation chargée: ${fileName}`, 3000);
      } else if (res && !res.success && res.error) {
        showMessage(`Erreur chargement conversation: ${res.error}`, 5000);
      }
    } catch (error) {
      showMessage(`Erreur chargement conversation: ${error.message}`, 5000);
    } finally {
      setIsConversationLoading(false);
    }
  }, [
    currentProjectPath,
    isElectronApiAvailable,
    resetMultiAIState,
    resetPendingChangesState,
    setAiConversationHistory,
    showMessage
  ]);

  return {
    prompt,
    setPrompt,
    aiConversationHistory,
    setAiConversationHistory,
    sessions,
    activeSessionId,
    switchSession,
    renameSession,
    duplicateSession,
    deleteSession,
    conversations,
    activeConversationFile,
    isConversationLoading,
    autoSaveConversation,
    saveConversation,
    startNewConversation: createSession,
    loadConversationByFile
  };
};

export default useAIConversationSession;
