import React, { useState, useEffect, useRef } from 'react';
import './App.css';
import ErrorBoundary from './components/ErrorBoundary';
import FileExplorer from './components/FileExplorer';
import CodeEditor from './components/CodeEditor';
import AIChat from './components/AIChat';
import LivePreview from './components/LivePreview';
import Settings from './components/Settings';
import TerminalPanel from './components/TerminalPanel';
import useElectronAPI from './hooks/useElectronAPI';
import useFileOperations from './hooks/useFileOperations';
import useAI from './hooks/useAI';

const AppContent = () => {
  // State
  const [currentProjectPath, setCurrentProjectPath] = useState('');
  const [activeFile, setActiveFile] = useState('');
  const [code, setCode] = useState('');
  const [lineNumbers, setLineNumbers] = useState('');
  const [newItemName, setNewItemName] = useState('');
  const [aiProvider, setAiProvider] = useState('gemini');
  const [thinkingMode, setThinkingMode] = useState(false);
  const [previewStatus, setPreviewStatus] = useState('stopped');
  const [leftWidth, setLeftWidth] = useState(24);
  const [rightWidth, setRightWidth] = useState(26);
  const [dragging, setDragging] = useState(null);
  const [dragStartX, setDragStartX] = useState(0);
  const [startWidths, setStartWidths] = useState({ left: 24, right: 26 });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [centerView, setCenterView] = useState('code'); // 'code' | 'preview' | 'terminal'
  const [devPort, setDevPort] = useState('3004');

  const layoutRef = useRef(null);

  // Custom hooks
  const { isAvailable: isElectronApiAvailable, message, showMessage } = useElectronAPI();
  
  const {
    projectItems,
    expandedFolders,
    loadProjectItems,
    toggleFolderExpansion,
    createNewItem,
    deleteItem,
    openFolder
  } = useFileOperations(currentProjectPath, isElectronApiAvailable, showMessage, setActiveFile);

  const {
    prompt,
    setPrompt,
    isLoading,
    aiConversationHistory,
    previousCode,
    generateAIResponse,
    addImageMessage,
    saveConversation,
    handleUndo,
    multiAIState,
    conversations,
    activeConversationFile,
    isConversationLoading,
    startNewConversation,
    loadConversationByFile,
    stopGeneration
  } = useAI(
    currentProjectPath,
    code,
    setCode,
    activeFile,
    isElectronApiAvailable,
    showMessage,
    setActiveFile,
    loadProjectItems,
    aiProvider,
    thinkingMode
  );

  const clamp = (value, min, max) => {
    return Math.min(max, Math.max(min, value));
  };

  // Update line numbers when code changes
  useEffect(() => {
    const lines = code.split('\n');
    const numbers = lines.map((_, index) => index + 1).join('\n');
    setLineNumbers(numbers);
  }, [code]);

  useEffect(() => {
    if (!dragging) return;

    const handleMouseMove = (e) => {
      // Si aucun bouton n'est enfoncé, arrêter le redimensionnement
      if (e.buttons === 0) {
        setDragging(null);
        return;
      }

      if (!layoutRef.current) return;
      const rect = layoutRef.current.getBoundingClientRect();
      const totalWidth = rect.width;
      if (!totalWidth) return;

      const deltaPercent = ((e.clientX - dragStartX) / totalWidth) * 100;
      const minLeft = 15;
      const minRight = 18;
      const minMiddle = 30;

      if (dragging === 'left') {
        let newLeft = clamp(startWidths.left + deltaPercent, minLeft, 100 - minMiddle - startWidths.right);
        const middle = 100 - newLeft - startWidths.right;
        if (middle < minMiddle) {
          newLeft = 100 - minMiddle - startWidths.right;
        }
        setLeftWidth(newLeft);
      } else if (dragging === 'right') {
        let newRight = clamp(startWidths.right - deltaPercent, minRight, 100 - minMiddle - startWidths.left);
        const middle = 100 - startWidths.left - newRight;
        if (middle < minMiddle) {
          newRight = 100 - minMiddle - startWidths.left;
        }
        setRightWidth(newRight);
      }
    };

    const handleMouseUp = () => {
      setDragging(null);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [dragging, dragStartX, startWidths, clamp]);

  // Load file content when active file changes
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    const loadFileContent = async () => {
      if (activeFile && currentProjectPath && isElectronApiAvailable) {
        try {
          const response = await window.electronAPI.readFile(currentProjectPath, activeFile);
          if (response.success) {
            setCode(response.content);
            showMessage(`Fichier "${activeFile}" chargé.`, 2000);
          } else {
            setCode('');
            showMessage(`Erreur: ${response.error}`, 5000);
          }
        } catch (error) {
          showMessage(`Erreur: ${error.message}`, 5000);
        }
      } else {
        setCode('');
      }
    };
    loadFileContent();
  }, [activeFile, currentProjectPath, isElectronApiAvailable]);

  // Handlers
  const handleCodeChange = async (newCode) => {
    setCode(newCode);
    if (!isElectronApiAvailable || !activeFile || !currentProjectPath) return;
    
    try {
      await window.electronAPI.writeFile(currentProjectPath, activeFile, newCode);
    } catch (error) {
      console.error('Erreur sauvegarde:', error);
    }
  };

  const handleOpenFolder = async () => {
    const path = await openFolder();
    if (path) {
      setCurrentProjectPath(path);
      setActiveFile('');
    }
  };

  useEffect(() => {
    if (!isElectronApiAvailable) return;
    if (!window.electronAPI || typeof window.electronAPI.onMenuOpenFolder !== 'function') return;
    window.electronAPI.onMenuOpenFolder(() => {
      handleOpenFolder();
    });
  }, [isElectronApiAvailable]);

  useEffect(() => {
    if (!isElectronApiAvailable) return;
    if (!window.electronAPI || typeof window.electronAPI.onMenuOpenSettings !== 'function') return;
    window.electronAPI.onMenuOpenSettings(() => {
      setSettingsOpen(true);
    });
  }, [isElectronApiAvailable]);

  // Charger le port de dev depuis les Settings pour la Preview
  useEffect(() => {
    const loadSettingsForPreview = async () => {
      if (!isElectronApiAvailable || !window.electronAPI?.loadSettings) return;
      try {
        const res = await window.electronAPI.loadSettings();
        if (res?.success && res.settings?.devPort) {
          setDevPort(String(res.settings.devPort));
        }
      } catch (e) {
        // silencieux
      }
    };
    loadSettingsForPreview();
  }, [isElectronApiAvailable]);

  const handleFileClick = (filePath) => {
    setActiveFile(filePath);
  };

  const handleDragStart = (e, type) => {
    e.preventDefault();
    setDragging(type);
    setDragStartX(e.clientX);
    setStartWidths({ left: leftWidth, right: rightWidth });
  };

  // Handlers pour la Live Preview
  const handleTogglePreview = () => {
    if (previewStatus === 'running') {
      setPreviewStatus('stopped');
      showMessage('Preview arrêtée', 2000);
    } else {
      setPreviewStatus('running');
      showMessage('Preview démarrée', 2000);
    }
  };

  const handlePreviewRefresh = () => {
    showMessage('Preview rafraîchie', 1500);
  };

  // Render
  const middleWidth = 100 - leftWidth - rightWidth;
  const previewUrl = `http://localhost:${devPort}`;

  return (
    <div className="app-background min-h-screen text-gray-100 font-mono relative overflow-hidden flex flex-col">
      {/* Particles background */}
      <div className="particles">
        {[...Array(20)].map((_, i) => (
          <div
            key={i}
            className="particle"
            style={{
              left: `${Math.random() * 100}%`,
              top: `${Math.random() * 100}%`,
              animationDelay: `${Math.random() * 6}s`,
              animationDuration: `${4 + Math.random() * 4}s`,
            }}
          />
        ))}
      </div>

      {/* Message display */}
      {message && (
        <div className="message-slide fixed top-4 right-4 bg-gradient-to-r from-sky-500 to-cyan-500 text-white px-6 py-3 rounded-lg shadow-2xl z-50 border border-cyan-400">
          <div className="flex items-center space-x-2">
            <div className="w-2 h-2 bg-white rounded-full animate-pulse"></div>
            <span className="font-medium">{message}</span>
          </div>
        </div>
      )}

      {/* Preview Control Bar */}
      <div className="flex items-center justify-between px-4 py-2 bg-black bg-opacity-40 border-b border-gray-700">
        <div className="flex items-center space-x-4">
          <span className="text-sm text-gray-400">Live Preview:</span>
          <button
            onClick={handleTogglePreview}
            className={`flex items-center space-x-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
              previewStatus === 'running'
                ? 'bg-red-500 bg-opacity-20 text-red-400 hover:bg-opacity-30'
                : 'bg-green-500 bg-opacity-20 text-green-400 hover:bg-opacity-30'
            }`}
          >
            {previewStatus === 'running' ? (
              <>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 10a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z" />
                </svg>
                <span>Arrêter</span>
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span>Démarrer Preview</span>
              </>
            )}
          </button>
        </div>
        <div className="flex items-center space-x-2">
          <span className="text-xs text-gray-500 mr-2">
            {currentProjectPath || 'Aucun projet ouvert'}
          </span>
          <button
            onClick={() => setSettingsOpen(true)}
            className="flex items-center space-x-1 px-3 py-1.5 rounded-lg text-sm font-medium bg-gray-700 bg-opacity-50 text-gray-300 hover:bg-opacity-70 transition-all"
            title="Paramètres"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            <span>Settings</span>
          </button>
        </div>
      </div>

      {/* Main content */}
      <div ref={layoutRef} className="flex-grow w-full flex flex-row p-4">
        {/* Left Panel: File Explorer */}
        <div
          className="flex flex-col glass-effect p-4 rounded-2xl border border-gray-700 shadow-2xl"
          style={{ width: `${leftWidth}%` }}
        >
          <FileExplorer
            projectItems={projectItems}
            currentProjectPath={currentProjectPath}
            activeFile={activeFile}
            expandedFolders={expandedFolders}
            newItemName={newItemName}
            isElectronApiAvailable={isElectronApiAvailable}
            onOpenFolder={handleOpenFolder}
            onCreateItem={createNewItem}
            onDeleteItem={deleteItem}
            onToggleFolder={toggleFolderExpansion}
            onFileClick={handleFileClick}
            onNewItemNameChange={setNewItemName}
          />
        </div>

        <div
          className={`panel-resizer mx-2 ${dragging === 'left' ? 'panel-resizer-active' : ''}`}
          onMouseDown={(e) => handleDragStart(e, 'left')}
        ></div>

        {/* Middle Panel: Code / Preview Tabs */}
        <div
          className="flex flex-col glass-effect rounded-2xl border border-gray-700 shadow-2xl overflow-hidden code-editor"
          style={{ width: `${middleWidth}%` }}
        >
          {/* Tabs */}
          <div className="bg-black bg-opacity-20 border-b border-gray-700 px-3 py-2 flex items-center gap-2">
            <button
              onClick={() => setCenterView('code')}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium ${
                centerView === 'code' ? 'bg-cyan-600 text-white' : 'text-gray-300 hover:text-white hover:bg-gray-700'
              }`}
            >
              Code
            </button>
            <button
              onClick={() => setCenterView('preview')}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium ${
                centerView === 'preview' ? 'bg-cyan-600 text-white' : 'text-gray-300 hover:text-white hover:bg-gray-700'
              }`}
            >
              Preview
            </button>
            <button
              onClick={() => setCenterView('terminal')}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium ${
                centerView === 'terminal' ? 'bg-cyan-600 text-white' : 'text-gray-300 hover:text-white hover:bg-gray-700'
              }`}
            >
              Terminal
            </button>
          </div>

          {/* Content */}
          {centerView === 'code' && (
            <CodeEditor
              activeFile={activeFile}
              code={code}
              lineNumbers={lineNumbers}
              previousCode={previousCode}
              onCodeChange={handleCodeChange}
              onUndo={handleUndo}
            />
          )}
          {centerView === 'preview' && (
            <LivePreview
              projectId={currentProjectPath || 'default'}
              status={previewStatus}
              onRefresh={handlePreviewRefresh}
              previewUrl={previewUrl}
              className="flex-1"
            />
          )}
          {centerView === 'terminal' && (
            <TerminalPanel
              currentProjectPath={currentProjectPath}
              isElectronApiAvailable={isElectronApiAvailable}
              showMessage={showMessage}
            />
          )}
        </div>

        <div
          className={`panel-resizer mx-2 ${dragging === 'right' ? 'panel-resizer-active' : ''}`}
          onMouseDown={(e) => handleDragStart(e, 'right')}
        ></div>

        {/* Right Panel: AI Chat + Live Preview */}
        <div
          className="flex flex-col space-y-4"
          style={{ width: `${rightWidth}%` }}
        >
          {/* AI Chat Section */}
          <div className="flex flex-col glass-effect p-4 rounded-2xl border border-gray-700 shadow-2xl" style={{ height: '50%' }}>
            <AIChat
              prompt={prompt}
              conversationHistory={aiConversationHistory}
              isLoading={isLoading}
              currentProjectPath={currentProjectPath}
              isElectronApiAvailable={isElectronApiAvailable}
              onPromptChange={setPrompt}
              onSend={generateAIResponse}
              onSaveConversation={saveConversation}
              aiProvider={aiProvider}
              onProviderChange={setAiProvider}
              thinkingMode={thinkingMode}
              onThinkingModeChange={setThinkingMode}
              onPasteImage={addImageMessage}
              multiAIState={multiAIState}
              conversations={conversations}
              activeConversationFile={activeConversationFile}
              isConversationLoading={isConversationLoading}
              onNewConversation={startNewConversation}
              onSelectConversation={loadConversationByFile}
              onStopGeneration={stopGeneration}
            />
          </div>

          {/* Live Preview Section (déplacée dans l'onglet central) */}
        </div>
      </div>

      {/* Settings Modal */}
      <Settings
        isOpen={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        isElectronApiAvailable={isElectronApiAvailable}
        showMessage={showMessage}
      />
    </div>
  );
};

const App = () => (
  <ErrorBoundary>
    <AppContent />
  </ErrorBoundary>
);

export default App;
