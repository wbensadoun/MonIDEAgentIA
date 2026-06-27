import { useCallback, useEffect, useState } from 'react';

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
  const [aiConversationHistory, setAiConversationHistory] = useState([]);
  const [conversations, setConversations] = useState([]);
  const [activeConversationFile, setActiveConversationFile] = useState(null);
  const [isConversationLoading, setIsConversationLoading] = useState(false);

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
  }, [currentProjectPath, aiConversationHistory, showMessage, refreshConversations]);

  const startNewConversation = useCallback(() => {
    setAiConversationHistory([]);
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
    abortController,
    aiProvider,
    resetContextEstimate,
    resetMultiAIState,
    resetPendingChangesState,
    setAbortController
  ]);

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
    showMessage
  ]);

  return {
    prompt,
    setPrompt,
    aiConversationHistory,
    setAiConversationHistory,
    conversations,
    activeConversationFile,
    isConversationLoading,
    autoSaveConversation,
    saveConversation,
    startNewConversation,
    loadConversationByFile
  };
};

export default useAIConversationSession;
