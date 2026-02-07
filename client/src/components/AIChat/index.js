import React, { useRef, useEffect, useState } from 'react';
import './AIChat.css';
import { LoadingSteps, LoadingPulse } from '../LoadingAnimations';

const AIChat = ({
  prompt,
  conversationHistory,
  isLoading,
  currentProjectPath,
  isElectronApiAvailable,
  onPromptChange,
  onSend,
  onSaveConversation,
  aiProvider = 'gemini',
  onProviderChange,
  thinkingMode = false,
  onThinkingModeChange,
  onPasteImage,
  multiAIState,
  conversations = [],
  activeConversationFile,
  isConversationLoading = false,
  onNewConversation,
  onSelectConversation,
  onStopGeneration
}) => {
  const conversationHistoryRef = useRef(null);
  const [showConversations, setShowConversations] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    if (conversationHistoryRef.current) {
      conversationHistoryRef.current.scrollTop = conversationHistoryRef.current.scrollHeight;
    }
  }, [conversationHistory, isLoading]);

  const handleSend = () => {
    console.log('[AIChat] handleSend appelé:', { prompt: prompt.trim(), isLoading, onSend: !!onSend });
    if (prompt.trim() && !isLoading) {
      console.log('[AIChat] Conditions OK, appel de onSend()');
      onSend();
    } else {
      console.log('[AIChat] Conditions non remplies:', { 
        hasPrompt: !!prompt.trim(), 
        isLoading, 
        prompt: prompt.trim() 
      });
    }
  };

  const handlePaste = (e) => {
    if (!onPasteImage) return;

    const items = e.clipboardData?.items;
    if (!items) return;

    const imageItems = Array.from(items).filter(item => item.type && item.type.startsWith('image/'));
    if (imageItems.length === 0) return;

    e.preventDefault();

    imageItems.forEach((item) => {
      const file = item.getAsFile();
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (event) => {
        const result = event.target?.result;
        if (typeof result === 'string') {
          onPasteImage(result);
        }
      };
      reader.readAsDataURL(file);
    });
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const getRoleMeta = (msg) => {
    if (msg.role === 'system') {
      return {
        label: 'Système',
        badgeClass: 'chat-badge-system',
        bubbleClass: 'chat-bubble-system',
        alignClass: 'chat-row-system'
      };
    }

    if (msg.role === 'user') {
      return {
        label: 'Vous',
        badgeClass: 'chat-badge-user',
        bubbleClass: 'chat-bubble-user',
        alignClass: 'chat-row-user'
      };
    }

    // role === 'model'
    if (msg.isArchitect) {
      return {
        label: 'Architecte · Gemini',
        badgeClass: 'chat-badge-architect',
        bubbleClass: 'chat-bubble-architect',
        alignClass: 'chat-row-ai'
      };
    }

    if (msg.isReviewer) {
      return {
        label: 'Relecteur · Kimi',
        badgeClass: 'chat-badge-reviewer',
        bubbleClass: 'chat-bubble-reviewer',
        alignClass: 'chat-row-ai'
      };
    }

    if (msg.isCoder) {
      return {
        label: 'Codeur · Kimi',
        badgeClass: 'chat-badge-coder',
        bubbleClass: 'chat-bubble-coder',
        alignClass: 'chat-row-ai'
      };
    }

    return {
      label: 'IA',
      badgeClass: 'chat-badge-model',
      bubbleClass: 'chat-bubble-model',
      alignClass: 'chat-row-ai'
    };
  };

  const activeConversation = conversations.find(c => c.fileName === activeConversationFile) || null;
  const headerTitle = activeConversation ? activeConversation.title : 'Nouvelle conversation';
  const headerSubtitle = activeConversation
    ? new Date(activeConversation.createdAt).toLocaleString('fr-FR', { hour: '2-digit', minute: '2-digit' })
    : (currentProjectPath ? currentProjectPath : 'Aucun projet ouvert');

  const filteredConversations = conversations.filter((conv) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      (conv.title && conv.title.toLowerCase().includes(q)) ||
      (conv.fileName && conv.fileName.toLowerCase().includes(q))
    );
  });

  const handleSelectConversation = (fileName) => {
    if (!onSelectConversation || !fileName) return;
    onSelectConversation(fileName);
    setShowConversations(false);
  };

  return (
    <div className="flex flex-col h-full relative">
      <div className="flex items-center justify-between mb-2 pb-2 border-b border-gray-700/50">
        <div className="flex items-center space-x-2 overflow-hidden">
          <span className="text-xs text-cyan-400 font-medium">Agent IA</span>
          <span className="text-xs text-gray-400">|</span>
          <span className="text-xs text-gray-300 truncate max-w-[120px]">{headerTitle}</span>
        </div>

        <div className="flex items-center space-x-1">
          <button
            type="button"
            onClick={() => {
              if (onNewConversation) {
                onNewConversation();
              }
              setShowConversations(false);
            }}
            className="p-1 text-[10px] text-gray-400 hover:text-cyan-400"
            title="Nouvelle conversation"
            disabled={!currentProjectPath || !isElectronApiAvailable}
          >
            + New
          </button>

          <button
            type="button"
            onClick={() => setShowConversations(prev => !prev)}
            className="p-1 text-[10px] text-gray-400 hover:text-cyan-400"
            title="Historique"
            disabled={!currentProjectPath || !isElectronApiAvailable}
          >
            History
          </button>

          <label className="flex items-center space-x-1 text-[10px] text-gray-400">
            <input
              type="checkbox"
              className="h-3 w-3"
              checked={thinkingMode}
              onChange={(e) => onThinkingModeChange && onThinkingModeChange(e.target.checked)}
              disabled={!isElectronApiAvailable || isLoading}
            />
            <span>Think</span>
          </label>

          <select
            value={aiProvider}
            onChange={(e) => onProviderChange && onProviderChange(e.target.value)}
            className="bg-transparent border-none text-[10px] text-gray-300 focus:outline-none"
            disabled={!isElectronApiAvailable || isLoading}
            title="IA"
          >
            <option value="gemini">Gemini</option>
            <option value="kimi">Kimi K2.5</option>
            <option value="multi">Multi-IA (Gemini+Kimi)</option>
          </select>

          <button
            onClick={onSaveConversation}
            className="text-[10px] text-gray-400 hover:text-cyan-400"
            disabled={!currentProjectPath || conversationHistory.length === 0 || !isElectronApiAvailable}
            title="Sauver"
          >
            Save
          </button>
        </div>
      </div>

      {showConversations && (
        <div className="absolute top-8 left-0 right-0 z-20">
          <div className="bg-gray-900 border border-gray-700 rounded shadow-lg max-h-60 flex flex-col">
            <div className="flex items-center justify-between px-2 py-1 border-b border-gray-700">
              <span className="text-[10px] text-gray-300">Conversations</span>
              <span className="text-[9px] text-gray-500">{conversations.length}</span>
            </div>
            <div className="px-2 py-1 border-b border-gray-700">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Rechercher..."
                className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-[10px] text-gray-200 focus:outline-none focus:border-cyan-500"
              />
            </div>
            <div className="overflow-y-auto text-[10px]">
              {isConversationLoading && (
                <div className="px-2 py-1 text-gray-500">Chargement...</div>
              )}
              {!isConversationLoading && filteredConversations.length === 0 && (
                <div className="px-2 py-1 text-gray-500">Aucune</div>
              )}
              {!isConversationLoading && filteredConversations.length > 0 && (
                <ul className="text-gray-300">
                  {filteredConversations.map((conv) => (
                    <li
                      key={conv.fileName}
                      className={`px-2 py-1 flex items-center justify-between cursor-pointer hover:bg-gray-800 ${
                        conv.fileName === activeConversationFile ? 'bg-gray-800' : ''
                      }`}
                      onClick={() => handleSelectConversation(conv.fileName)}
                    >
                      <span className="truncate">{conv.title}</span>
                      <span className="text-gray-500 whitespace-nowrap ml-2">
                        {new Date(conv.createdAt).toLocaleDateString('fr-FR', { month: 'numeric', day: 'numeric' })}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}

      {multiAIState?.isActive && (
        <div className="mb-3">
          <LoadingSteps 
            steps={multiAIState.steps} 
            currentStep={multiAIState.steps.findIndex(s => s.status === 'active')} 
          />
          {multiAIState.currentPhase && (
            <div className="multi-ai-phase-hint">
              <span className="phase-label">Phase actuelle :</span>
              <span className="phase-value">{multiAIState.currentPhase}</span>
              {multiAIState.error && (
                <span className="phase-error">Erreur : {multiAIState.error}</span>
              )}
            </div>
          )}
        </div>
      )}

      {isLoading && !multiAIState?.isActive && (
        <div className="mb-3">
          <LoadingPulse text="L'IA réfléchit..." variant="default" />
        </div>
      )}

      <textarea
        id="ai-prompt"
        className="focus-ring w-full bg-black bg-opacity-20 text-gray-100 p-3 rounded-lg border border-gray-600 resize-y text-sm custom-scrollbar mb-3"
        value={prompt}
        onChange={(e) => onPromptChange(e.target.value)}
        onKeyPress={handleKeyPress}
        onPaste={handlePaste}
        placeholder="Votre requête..."
        rows={2}
      />

      <button
        onClick={isLoading ? (onStopGeneration || (() => {})) : handleSend}
        className={`btn-hover-effect focus-ring font-bold py-3 px-4 rounded-lg shadow-lg text-md transition-all ${
          isLoading 
            ? 'bg-gradient-to-r from-red-500 to-orange-600 hover:from-red-600 hover:to-orange-700' 
            : 'bg-gradient-to-r from-green-500 to-cyan-600 hover:from-green-600 hover:to-cyan-700'
        } text-white`}
        disabled={!currentProjectPath || !isElectronApiAvailable}
      >
        {isLoading ? (
          <span className="flex items-center justify-center">
            <svg className="animate-spin h-5 w-5 mr-3" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
            Arrêter
          </span>
        ) : (
          "Envoyer  l'IA"
        )}
      </button>

      <div
        ref={conversationHistoryRef}
        className="ai-chat-history flex-grow bg-black bg-opacity-20 p-2 rounded-lg text-gray-200 overflow-y-auto custom-scrollbar mt-3 text-sm"
      >
        {conversationHistory.length === 0 && !isLoading && (
          <div className="text-center text-gray-500 p-4">
            <p>Commencez à discuter avec l&apos;IA</p>
            <p className="text-xs mt-1">L&apos;IA comprend le contexte complet de votre projet</p>
          </div>
        )}

        {conversationHistory.map((msg, index) => {
          const meta = getRoleMeta(msg);
          return (
            <div key={index} className={`chat-message ${meta.alignClass}`}>
              <div className={meta.bubbleClass}>
                <div className="chat-message-header">
                  <span className={`chat-badge ${meta.badgeClass}`}>{meta.label}</span>
                </div>
                <p className="chat-message-text whitespace-pre-wrap text-xs mt-1">{msg.text}</p>

                {Array.isArray(msg.images) && msg.images.length > 0 && (
                  <div className="chat-images">
                    {msg.images.map((img, i) => (
                      <div key={i} className="chat-image-wrapper">
                        <img
                          src={img.dataUrl}
                          alt="Image collée"
                          className="chat-image-thumb"
                        />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {isLoading && !multiAIState?.isActive && (
          <div className="text-center p-2">
            <p className="text-xs text-gray-400 animate-pulse">L&apos;IA réfléchit...</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default AIChat;
