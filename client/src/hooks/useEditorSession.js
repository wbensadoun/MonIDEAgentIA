import { useCallback, useEffect, useRef, useState } from 'react';
import {
  isNavigatorDescendant,
  isSameNavigatorPath,
  replaceNavigatorPathPrefix
} from '../utils/navigatorPaths';

const normalizeDraftPreview = (draft) => ({
  filePath: String(draft.filePath || '').trim(),
  code: String(draft.code || ''),
  language: String(draft.language || '').trim(),
  agent: String(draft.agent || '').trim()
});

const useEditorSession = ({
  currentProjectPath,
  isElectronApiAvailable,
  showMessage,
  isReadOnlyMode,
  centerView,
  setCenterView
}) => {
  const [activeFile, setActiveFile] = useState('');
  const [code, setCode] = useState('');
  const [openFiles, setOpenFiles] = useState([]);
  const [revealRequest, setRevealRequest] = useState(null);
  const [aiDraftPreview, setAiDraftPreview] = useState(null);
  const [gitDiffPreview, setGitDiffPreview] = useState(null);
  // Suivi des fichiers modifies mais pas encore ecrits sur disque (indicateur point sur les tabs)
  const [dirtyFiles, setDirtyFiles] = useState(() => new Set());

  const markFileDirty = useCallback((filePath) => {
    if (!filePath) return;
    setDirtyFiles((prev) => {
      if (prev.has(filePath)) return prev;
      const next = new Set(prev);
      next.add(filePath);
      return next;
    });
  }, []);

  const clearFileDirty = useCallback((filePath) => {
    if (!filePath) return;
    setDirtyFiles((prev) => {
      if (!prev.has(filePath)) return prev;
      const next = new Set(prev);
      next.delete(filePath);
      return next;
    });
  }, []);

  const saveTimerRef = useRef(null);
  const pendingSaveRef = useRef({ projectPath: '', filePath: '', content: '' });

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
      }
    };
  }, []);

  const scheduleSave = useCallback((projectPath, filePath, content) => {
    pendingSaveRef.current = { projectPath, filePath, content };

    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
    }

    saveTimerRef.current = setTimeout(async () => {
      const pending = pendingSaveRef.current;
      if (!pending.projectPath || !pending.filePath) return;

      try {
        await window.electronAPI.writeFile(pending.projectPath, pending.filePath, pending.content);
        clearFileDirty(pending.filePath);
      } catch (error) {
        console.error('Erreur sauvegarde:', error);
      }
    }, 450);
  }, [clearFileDirty]);

  useEffect(() => {
    const loadFileContent = async () => {
      if (gitDiffPreview?.filePath && gitDiffPreview.filePath === activeFile) {
        return;
      }

      if (activeFile && currentProjectPath && isElectronApiAvailable) {
        try {
          const response = await window.electronAPI.readFile(currentProjectPath, activeFile);
          if (response.success) {
            setCode(response.content);
            clearFileDirty(activeFile);
            showMessage(`Fichier "${activeFile}" charge.`, 2000);
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
  }, [activeFile, currentProjectPath, gitDiffPreview, isElectronApiAvailable, showMessage, clearFileDirty]);

  const handleCodeChange = useCallback((newCode) => {
    if (isReadOnlyMode) {
      showMessage('Mode lecture seule actif: edition desactivee.', 2500);
      return;
    }
    if (newCode === code) return;
    setCode(newCode);
    if (activeFile) markFileDirty(activeFile);
    if (!isElectronApiAvailable || !activeFile || !currentProjectPath) return;
    scheduleSave(currentProjectPath, activeFile, newCode);
  }, [
    activeFile,
    code,
    currentProjectPath,
    isElectronApiAvailable,
    isReadOnlyMode,
    markFileDirty,
    scheduleSave,
    showMessage
  ]);

  const handleStreamingDraftChange = useCallback((draft) => {
    if (draft) {
      setGitDiffPreview(null);
    }

    setAiDraftPreview((prev) => {
      if (!draft) {
        return prev ? null : prev;
      }

      const next = normalizeDraftPreview(draft);
      if (
        prev &&
        prev.filePath === next.filePath &&
        prev.code === next.code &&
        prev.language === next.language &&
        prev.agent === next.agent
      ) {
        return prev;
      }

      return next;
    });

    if (draft && centerView !== 'code') {
      setCenterView('code');
    }
  }, [centerView, setCenterView]);

  const clearGitDiffPreview = useCallback(() => {
    setGitDiffPreview(null);
  }, []);

  const resetEditorSession = useCallback(() => {
    setOpenFiles([]);
    setActiveFile('');
    setRevealRequest(null);
    setAiDraftPreview(null);
    setGitDiffPreview(null);
  }, []);

  const openFile = useCallback((filePath, opts = {}) => {
    if (!filePath) return;
    if (!opts?.preserveGitPreview) {
      clearGitDiffPreview();
    }
    setOpenFiles((prev) => (prev.includes(filePath) ? prev : [...prev, filePath]));
    setActiveFile(filePath);

    if (opts && typeof opts === 'object' && opts.reveal) {
      const reveal = opts.reveal;
      setRevealRequest({
        file: filePath,
        line: reveal.line,
        column: reveal.column,
        key: Date.now()
      });
    }
  }, [clearGitDiffPreview]);

  const handleGitPanelOpenFile = useCallback((entry, _sectionId) => {
    const filePath = String(entry?.file || '').trim();
    if (!filePath) return;

    if (entry?.deleted) {
      showMessage('Ce fichier est supprime dans le working tree. Ouvrez le diff Git pour l\'inspecter.', 3000);
      return;
    }

    setCenterView('code');
    openFile(filePath);
  }, [openFile, setCenterView, showMessage]);

  const handleOpenGitDiff = useCallback(async (entry, sectionId) => {
    if (!currentProjectPath || !isElectronApiAvailable || typeof window.electronAPI?.gitReadFileState !== 'function') {
      showMessage('Inspection Git indisponible.', 3000);
      return;
    }

    const filePath = String(entry?.file || '').trim();
    if (!filePath) return;

    try {
      const response = await window.electronAPI.gitReadFileState(currentProjectPath, filePath);
      if (!response?.success) {
        showMessage(`Diff Git: ${response?.error || 'erreur inconnue'}`, 4000);
        return;
      }

      let originalCode = '';
      let modifiedCode = '';
      let baseLabel = 'HEAD';
      let targetLabel = 'working tree';

      if (sectionId === 'staged') {
        originalCode = response.existsInHead ? response.headContent : '';
        modifiedCode = response.existsInIndex ? response.indexContent : '';
        baseLabel = response.existsInHead ? 'HEAD' : 'empty';
        targetLabel = response.existsInIndex ? 'index' : 'deleted';
      } else {
        originalCode = response.existsInIndex
          ? response.indexContent
          : (response.existsInHead ? response.headContent : '');
        modifiedCode = response.existsInWorking ? response.workingContent : '';
        baseLabel = response.existsInIndex ? 'index' : (response.existsInHead ? 'HEAD' : 'empty');
        targetLabel = response.existsInWorking ? 'working tree' : 'deleted';
      }

      setGitDiffPreview({
        filePath: response.filePath,
        originalCode,
        modifiedCode,
        sectionId,
        baseLabel,
        targetLabel,
        comparisonKey: `${sectionId}:${response.filePath}:${String(entry?.previousFile || '')}`,
        existsInWorking: !!response.existsInWorking
      });
      setCenterView('code');

      if (response.existsInWorking) {
        openFile(response.filePath, { preserveGitPreview: true });
      }
    } catch (error) {
      showMessage(`Diff Git: ${error.message}`, 4000);
    }
  }, [currentProjectPath, isElectronApiAvailable, openFile, setCenterView, showMessage]);

  const syncNavigatorReferences = useCallback((previousPath, nextPath) => {
    if (!previousPath || !nextPath) return;

    setOpenFiles((prev) => {
      const mapped = prev.map((filePath) => replaceNavigatorPathPrefix(filePath, previousPath, nextPath));
      return Array.from(new Set(mapped));
    });
    setActiveFile((prev) => replaceNavigatorPathPrefix(prev, previousPath, nextPath));
    setRevealRequest((prev) => {
      if (!prev?.file) return prev;
      const nextFile = replaceNavigatorPathPrefix(prev.file, previousPath, nextPath);
      return nextFile === prev.file ? prev : { ...prev, file: nextFile };
    });
    setAiDraftPreview((prev) => {
      if (!prev?.filePath) return prev;
      const nextFile = replaceNavigatorPathPrefix(prev.filePath, previousPath, nextPath);
      return nextFile === prev.filePath ? prev : { ...prev, filePath: nextFile };
    });
    setGitDiffPreview((prev) => {
      if (!prev?.filePath) return prev;
      const nextFile = replaceNavigatorPathPrefix(prev.filePath, previousPath, nextPath);
      return nextFile === prev.filePath ? prev : { ...prev, filePath: nextFile };
    });
  }, []);

  const removeNavigatorReferences = useCallback((deletedPath) => {
    if (!deletedPath) return;

    setOpenFiles((prev) => {
      const next = prev.filter((filePath) => (
        !isSameNavigatorPath(filePath, deletedPath) &&
        !isNavigatorDescendant(filePath, deletedPath)
      ));

      setActiveFile((currentActiveFile) => {
        if (
          !currentActiveFile ||
          (!isSameNavigatorPath(currentActiveFile, deletedPath) &&
            !isNavigatorDescendant(currentActiveFile, deletedPath))
        ) {
          return currentActiveFile;
        }
        return next[0] || '';
      });

      return next;
    });

    setRevealRequest((prev) => {
      if (!prev?.file) return prev;
      if (isSameNavigatorPath(prev.file, deletedPath) || isNavigatorDescendant(prev.file, deletedPath)) {
        return null;
      }
      return prev;
    });

    setAiDraftPreview((prev) => {
      if (!prev?.filePath) return prev;
      if (isSameNavigatorPath(prev.filePath, deletedPath) || isNavigatorDescendant(prev.filePath, deletedPath)) {
        return null;
      }
      return prev;
    });
    setGitDiffPreview((prev) => {
      if (!prev?.filePath) return prev;
      if (isSameNavigatorPath(prev.filePath, deletedPath) || isNavigatorDescendant(prev.filePath, deletedPath)) {
        return null;
      }
      return prev;
    });
  }, []);

  const closeFileTab = useCallback((filePath) => {
    if (!filePath) return;
    if (String(gitDiffPreview?.filePath || '') === String(filePath)) {
      clearGitDiffPreview();
    }
    clearFileDirty(filePath);
    setOpenFiles((prev) => {
      const idx = prev.indexOf(filePath);
      if (idx === -1) return prev;
      const next = prev.filter((f) => f !== filePath);

      if (String(filePath) === String(activeFile)) {
        const fallback = next[idx - 1] || next[idx] || '';
        setActiveFile(fallback);
        if (!fallback) {
          setCode('');
        }
      }

      return next;
    });
  }, [activeFile, clearFileDirty, clearGitDiffPreview, gitDiffPreview?.filePath]);

  return {
    activeFile,
    setActiveFile,
    code,
    setCode,
    openFiles,
    setOpenFiles,
    dirtyFiles,
    revealRequest,
    aiDraftPreview,
    gitDiffPreview,
    displayedActiveFile: aiDraftPreview?.filePath || gitDiffPreview?.filePath || activeFile,
    displayedCode: aiDraftPreview?.code ?? gitDiffPreview?.modifiedCode ?? code,
    isStreamingCodePreview: Boolean(aiDraftPreview?.filePath),
    editorReadOnly: isReadOnlyMode || Boolean(aiDraftPreview?.filePath) || Boolean(gitDiffPreview),
    clearGitDiffPreview,
    resetEditorSession,
    openFile,
    closeFileTab,
    handleCodeChange,
    handleStreamingDraftChange,
    handleGitPanelOpenFile,
    handleOpenGitDiff,
    syncNavigatorReferences,
    removeNavigatorReferences
  };
};

export default useEditorSession;
