import { useCallback, useEffect, useState } from 'react';

const buildPatchId = () => `patch-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;

const useAIPendingChanges = ({
  currentProjectPath,
  activeFile,
  setCode,
  setActiveFile,
  isElectronApiAvailable,
  showMessage,
  loadProjectItems,
  permissionMode = 'edit_terminal',
  qualityGateConfig = {}
}) => {
  const [previousCode, setPreviousCode] = useState('');
  const [isDiffMode, setIsDiffMode] = useState(false);
  const [pendingFileChanges, setPendingFileChanges] = useState([]);
  const [activePendingChangeId, setActivePendingChangeId] = useState(null);
  const [pendingSnapshotId, setPendingSnapshotId] = useState(null);
  const [appliedPatchHistory, setAppliedPatchHistory] = useState([]);
  const [qualityGatePassedBatch, setQualityGatePassedBatch] = useState(false);

  const sanitizeProposedFilePath = useCallback((fileName) => {
    const raw = String(fileName || '').trim();
    if (!raw) return '';

    if (/^[a-zA-Z]:[\\/]/.test(raw) || raw.startsWith('/') || raw.startsWith('\\')) {
      return '';
    }

    const segments = raw
      .replace(/\\/g, '/')
      .split('/')
      .map((segment) => String(segment || '').trim())
      .filter(Boolean);

    if (segments.length === 0) return '';
    if (segments.some((segment) => segment === '.' || segment === '..')) return '';

    const cleaned = segments
      .map((segment) => segment.split('\0').join('').replace(/[<>:"|?*]/g, '_').trim())
      .filter(Boolean);

    return cleaned.join('/');
  }, []);

  const buildFileProposal = useCallback(async (fileName, fileContent) => {
    if (!isElectronApiAvailable || !currentProjectPath || !window.electronAPI?.readFile) return null;

    const cleanFileName = sanitizeProposedFilePath(fileName);
    if (!cleanFileName) return null;

    let oldContent = '';
    let existed = false;
    let baseMtimeMs = null;
    try {
      const readRes = await window.electronAPI.readFile(currentProjectPath, cleanFileName);
      if (readRes?.success) {
        existed = true;
        oldContent = String(readRes.content || '');
        baseMtimeMs = Number.isFinite(Number(readRes.mtimeMs)) ? Number(readRes.mtimeMs) : null;
      }
    } catch {
      // keep defaults
    }

    const patchId = buildPatchId();
    return {
      id: patchId,
      patchId,
      filePath: cleanFileName,
      newContent: String(fileContent || ''),
      oldContent,
      existed,
      baseMtimeMs
    };
  }, [currentProjectPath, isElectronApiAvailable, sanitizeProposedFilePath]);

  const focusPendingChange = useCallback((change) => {
    if (!change || !change.filePath) {
      setActivePendingChangeId(null);
      return;
    }
    setActiveFile(change.filePath);
    setActivePendingChangeId(change.id || null);
    setPreviousCode(change.oldContent || '');
    setCode(change.newContent || '');
    setIsDiffMode(true);
  }, [setActiveFile, setCode]);

  const ensureSnapshotForPending = useCallback(async (changes) => {
    if (!Array.isArray(changes) || changes.length === 0) return true;
    if (pendingSnapshotId) return true;
    if (!window.electronAPI?.createAISnapshot || !currentProjectPath) return true;

    try {
      const files = changes.map((change) => change.filePath);
      const res = await window.electronAPI.createAISnapshot(currentProjectPath, files, 'ai-changes');
      if (res?.success) {
        setPendingSnapshotId(res.snapshotId || null);
        return true;
      }
      showMessage(`Snapshot non cree: ${res?.error || 'inconnu'}`, 3500);
      return false;
    } catch (error) {
      showMessage(`Snapshot non cree: ${error.message}`, 3500);
      return false;
    }
  }, [currentProjectPath, pendingSnapshotId, showMessage]);

  const runQualityGatesBeforeApply = useCallback(async ({ force = false } = {}) => {
    if (!qualityGateConfig?.onApply) return true;
    if (!force && qualityGatePassedBatch) return true;
    if (!window.electronAPI?.runQualityGates || !currentProjectPath) return true;

    try {
      const res = await window.electronAPI.runQualityGates(currentProjectPath, {
        lint: qualityGateConfig.lint,
        test: qualityGateConfig.test,
        build: qualityGateConfig.build,
        blockOnFail: qualityGateConfig.blockOnFail
      });

      if (!res?.success) {
        showMessage(`Quality gates: ${res?.error || 'erreur inconnue'}`, 5000);
        return false;
      }

      if (!res.passed) {
        const failed = (res.results || []).filter((gate) => !gate.ok).map((gate) => gate.id).join(', ');
        showMessage(`Quality gates echoues: ${failed || 'details indisponibles'}`, 5000);
        return false;
      }

      setQualityGatePassedBatch(true);
      showMessage('Quality gates valides.', 2500);
      return true;
    } catch (error) {
      showMessage(`Quality gates: ${error.message}`, 5000);
      return false;
    }
  }, [currentProjectPath, qualityGateConfig, qualityGatePassedBatch, showMessage]);

  const pushAppliedPatchHistory = useCallback((entries) => {
    if (!Array.isArray(entries) || entries.length === 0) return;
    const normalizedEntries = entries
      .filter((entry) => entry && entry.filePath && entry.patchId)
      .map((entry) => ({
        patchId: String(entry.patchId),
        filePath: String(entry.filePath),
        existedBefore: !!entry.existedBefore,
        previousContent: String(entry.previousContent || ''),
        appliedContent: String(entry.appliedContent || ''),
        appliedAt: entry.appliedAt || new Date().toISOString(),
        appliedMtimeMs: Number.isFinite(Number(entry.appliedMtimeMs)) ? Number(entry.appliedMtimeMs) : null
      }));

    if (normalizedEntries.length === 0) return;

    setAppliedPatchHistory((prev) => {
      const merged = [...prev, ...normalizedEntries];
      return merged.length > 80 ? merged.slice(merged.length - 80) : merged;
    });
  }, []);

  const rollbackPatchEntry = useCallback(async (entry) => {
    if (!entry || !currentProjectPath || !isElectronApiAvailable) {
      return { success: false, error: 'Contexte rollback indisponible' };
    }

    if (!entry.existedBefore) {
      if (!window.electronAPI?.deleteFile) {
        return { success: false, error: 'API deleteFile indisponible' };
      }

      try {
        const deleteOptions = Number.isFinite(Number(entry.appliedMtimeMs))
          ? { expectedMtimeMs: Number(entry.appliedMtimeMs) }
          : undefined;
        const res = await window.electronAPI.deleteFile(currentProjectPath, entry.filePath, deleteOptions);
        if (res?.success) return { success: true };
        const errorText = String(res?.error || '');
        if (/ENOENT|introuvable|not exist|n'existe/i.test(errorText)) {
          return { success: true };
        }
        return { success: false, error: res?.error || 'Echec suppression rollback' };
      } catch (error) {
        return { success: false, error: error.message };
      }
    }

    if (!window.electronAPI?.writeFile) {
      return { success: false, error: 'API writeFile indisponible' };
    }

    try {
      const writeOptions = Number.isFinite(Number(entry.appliedMtimeMs))
        ? { expectedMtimeMs: Number(entry.appliedMtimeMs) }
        : undefined;
      const res = await window.electronAPI.writeFile(
        currentProjectPath,
        entry.filePath,
        entry.previousContent || '',
        writeOptions
      );
      if (res?.success) {
        return { success: true, mtimeMs: Number.isFinite(Number(res.mtimeMs)) ? Number(res.mtimeMs) : null };
      }
      return { success: false, error: res?.error || 'Echec restauration rollback', code: res?.code };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }, [currentProjectPath, isElectronApiAvailable]);

  const rollbackAppliedEntries = useCallback(async (entries) => {
    const failures = [];
    const appliedEntries = Array.isArray(entries) ? entries : [];
    for (const entry of [...appliedEntries].reverse()) {
      const res = await rollbackPatchEntry(entry);
      if (!res?.success) {
        failures.push({ filePath: entry?.filePath, error: res?.error || 'rollback inconnu' });
      }
    }
    await loadProjectItems();
    return { success: failures.length === 0, failures };
  }, [loadProjectItems, rollbackPatchEntry]);

  const applyPendingChangeByIndex = useCallback(async (index) => {
    if (permissionMode === 'read_only') {
      showMessage('Mode lecture seule: application IA bloquee.', 3000);
      return false;
    }
    if (!Array.isArray(pendingFileChanges) || pendingFileChanges.length === 0) return false;
    const change = pendingFileChanges[index];
    if (!change) return false;

    const snapshotOk = await ensureSnapshotForPending(pendingFileChanges);
    if (!snapshotOk) return false;

    try {
      let res;
      const patchId = String(change.patchId || change.id || buildPatchId());
      if (change.existed) {
        const writeOptions = Number.isFinite(Number(change.baseMtimeMs))
          ? { expectedMtimeMs: Number(change.baseMtimeMs) }
          : undefined;
        res = await window.electronAPI.writeFile(currentProjectPath, change.filePath, change.newContent, writeOptions);
      } else {
        res = await window.electronAPI.createNewFile(currentProjectPath, change.filePath, change.newContent);
      }

      if (!res?.success) {
        if (res?.code === 'FILE_MODIFIED' || res?.code === 'FILE_MISSING') {
          showMessage(`Conflit detecte (${change.filePath}): rechargez puis regenerez le patch.`, 5500);
          return false;
        }
        showMessage(`Erreur application IA: ${res?.error || change.filePath}`, 5000);
        return false;
      }

      const appliedEntry = {
        patchId,
        filePath: change.filePath,
        existedBefore: !!change.existed,
        previousContent: change.oldContent || '',
        appliedContent: change.newContent || '',
        appliedAt: new Date().toISOString(),
        appliedMtimeMs: Number.isFinite(Number(res?.mtimeMs)) ? Number(res.mtimeMs) : null
      };

      const gatesOk = await runQualityGatesBeforeApply({ force: true });
      if (!gatesOk && qualityGateConfig?.blockOnFail !== false) {
        const rollback = await rollbackAppliedEntries([appliedEntry]);
        if (rollback.success) {
          showMessage(`Quality gates echoues: rollback applique (${change.filePath}).`, 5500);
        } else {
          showMessage(`Quality gates echoues: rollback incomplet (${rollback.failures.length}).`, 6500);
        }
        return false;
      }

      pushAppliedPatchHistory([appliedEntry]);

      const nextChanges = pendingFileChanges.filter((_, i) => i !== index);
      setPendingFileChanges(nextChanges);
      await loadProjectItems();

      if (nextChanges.length > 0) {
        focusPendingChange(nextChanges[Math.min(index, nextChanges.length - 1)]);
      } else {
        setActivePendingChangeId(null);
        setIsDiffMode(false);
        setPreviousCode('');
        setPendingSnapshotId(null);
        setQualityGatePassedBatch(false);
      }

      showMessage(`Modification IA appliquee (${patchId}): ${change.filePath}`, 2800);
      return true;
    } catch (error) {
      showMessage(`Erreur application IA: ${error.message}`, 5000);
      return false;
    }
  }, [
    permissionMode,
    pendingFileChanges,
    runQualityGatesBeforeApply,
    ensureSnapshotForPending,
    rollbackAppliedEntries,
    currentProjectPath,
    loadProjectItems,
    focusPendingChange,
    pushAppliedPatchHistory,
    qualityGateConfig,
    showMessage
  ]);

  const rejectPendingChangeByIndex = useCallback((index) => {
    if (!Array.isArray(pendingFileChanges) || pendingFileChanges.length === 0) return false;
    const change = pendingFileChanges[index];
    if (!change) return false;

    const nextChanges = pendingFileChanges.filter((_, i) => i !== index);
    setPendingFileChanges(nextChanges);

    if (nextChanges.length > 0) {
      focusPendingChange(nextChanges[Math.min(index, nextChanges.length - 1)]);
    } else {
      setActivePendingChangeId(null);
      setIsDiffMode(false);
      setPreviousCode('');
      if (activeFile === change.filePath) {
        setCode(change.oldContent || '');
      }
      setPendingSnapshotId(null);
      setQualityGatePassedBatch(false);
    }

    showMessage(`Modification IA rejetee: ${change.filePath}`, 2500);
    return true;
  }, [activeFile, pendingFileChanges, focusPendingChange, setCode, showMessage]);

  const applyAllPendingChanges = useCallback(async () => {
    if (permissionMode === 'read_only') {
      showMessage('Mode lecture seule: application IA bloquee.', 3000);
      return { success: false, applied: 0, failed: pendingFileChanges.length };
    }
    if (!Array.isArray(pendingFileChanges) || pendingFileChanges.length === 0) {
      return { success: true, applied: 0, failed: 0 };
    }

    const snapshotOk = await ensureSnapshotForPending(pendingFileChanges);
    if (!snapshotOk) return { success: false, applied: 0, failed: pendingFileChanges.length };

    let applied = 0;
    const failedChanges = [];
    const appliedEntries = [];

    for (const change of pendingFileChanges) {
      try {
        let res;
        const patchId = String(change.patchId || change.id || buildPatchId());
        if (change.existed) {
          const writeOptions = Number.isFinite(Number(change.baseMtimeMs))
            ? { expectedMtimeMs: Number(change.baseMtimeMs) }
            : undefined;
          res = await window.electronAPI.writeFile(currentProjectPath, change.filePath, change.newContent, writeOptions);
        } else {
          res = await window.electronAPI.createNewFile(currentProjectPath, change.filePath, change.newContent);
        }
        if (res?.success) {
          applied += 1;
          appliedEntries.push({
            patchId,
            filePath: change.filePath,
            existedBefore: !!change.existed,
            previousContent: change.oldContent || '',
            appliedContent: change.newContent || '',
            appliedAt: new Date().toISOString(),
            appliedMtimeMs: Number.isFinite(Number(res?.mtimeMs)) ? Number(res.mtimeMs) : null
          });
        } else {
          failedChanges.push(change);
          if (res?.code === 'FILE_MODIFIED' || res?.code === 'FILE_MISSING') {
            showMessage(`Conflit detecte (${change.filePath}): patch ignore.`, 4500);
          }
        }
      } catch {
        failedChanges.push(change);
      }
    }

    if (appliedEntries.length > 0) {
      const gatesOk = await runQualityGatesBeforeApply({ force: true });
      if (!gatesOk && qualityGateConfig?.blockOnFail !== false) {
        const rollback = await rollbackAppliedEntries(appliedEntries);
        if (rollback.success) {
          showMessage(`Quality gates echoues: rollback de ${appliedEntries.length} fichier(s).`, 6000);
        } else {
          showMessage(`Quality gates echoues: rollback incomplet (${rollback.failures.length}).`, 7000);
        }
        return { success: false, applied: 0, failed: pendingFileChanges.length, rolledBack: rollback.success };
      }
      pushAppliedPatchHistory(appliedEntries);
    }

    await loadProjectItems();
    setPendingFileChanges(failedChanges);

    if (failedChanges.length === 0) {
      setActivePendingChangeId(null);
      setIsDiffMode(false);
      setPreviousCode('');
      setPendingSnapshotId(null);
      setQualityGatePassedBatch(false);
      showMessage(`${applied} fichier(s) IA appliques.`, 3000);
    } else {
      focusPendingChange(failedChanges[0]);
      showMessage(`${applied} applique(s), ${failedChanges.length} en erreur.`, 4000);
    }

    return { success: failedChanges.length === 0, applied, failed: failedChanges.length };
  }, [
    permissionMode,
    pendingFileChanges,
    runQualityGatesBeforeApply,
    ensureSnapshotForPending,
    rollbackAppliedEntries,
    currentProjectPath,
    loadProjectItems,
    focusPendingChange,
    pushAppliedPatchHistory,
    qualityGateConfig,
    showMessage
  ]);

  const rejectAllPendingChanges = useCallback(() => {
    if (!Array.isArray(pendingFileChanges) || pendingFileChanges.length === 0) {
      return { success: true, rejected: 0 };
    }

    const rejectedCount = pendingFileChanges.length;
    const activeChange = pendingFileChanges.find((item) => item.id === activePendingChangeId) || pendingFileChanges[0];

    if (activeChange && activeFile === activeChange.filePath) {
      setCode(activeChange.oldContent || '');
    }

    setPendingFileChanges([]);
    setActivePendingChangeId(null);
    setIsDiffMode(false);
    setPreviousCode('');
    setPendingSnapshotId(null);
    setQualityGatePassedBatch(false);

    showMessage(`${rejectedCount} modification(s) IA rejetee(s).`, 3000);
    return { success: true, rejected: rejectedCount };
  }, [activeFile, activePendingChangeId, pendingFileChanges, setCode, showMessage]);

  useEffect(() => {
    if (!Array.isArray(pendingFileChanges) || pendingFileChanges.length === 0) {
      setActivePendingChangeId(null);
      return;
    }
    if (!activePendingChangeId) return;
    const exists = pendingFileChanges.some((change) => change.id === activePendingChangeId);
    if (!exists) {
      setActivePendingChangeId(pendingFileChanges[0]?.id || null);
    }
  }, [activePendingChangeId, pendingFileChanges]);

  const processAIFileModifications = useCallback(async (aiResponse) => {
    if (!aiResponse) return;
    try {
      const collectedProposals = [];

      const fileBlockRegex1 = /\*\*FICHIER:\s*(.+?)\*\*\s*```[\w]*\s*([\s\S]*?)```/gi;
      let match;
      while ((match = fileBlockRegex1.exec(aiResponse)) !== null) {
        const fileName = match[1]?.trim();
        const fileContent = match[2] ?? '';
        const proposal = await buildFileProposal(fileName, fileContent);
        if (proposal) collectedProposals.push(proposal);
      }

      const fileBlockRegex2 = /FILE:\s*(.+?)\s*\r?\n```[\w]*\s*([\s\S]*?)```/gi;
      while ((match = fileBlockRegex2.exec(aiResponse)) !== null) {
        const fileName = match[1]?.trim();
        const fileContent = match[2] ?? '';
        const proposal = await buildFileProposal(fileName, fileContent);
        if (proposal) collectedProposals.push(proposal);
      }

      const uniqueByPath = new Map();
      collectedProposals.forEach((proposal) => {
        if (!proposal?.filePath) return;
        uniqueByPath.set(proposal.filePath, proposal);
      });

      const proposals = Array.from(uniqueByPath.values());
      if (proposals.length > 0) {
        setPendingFileChanges((prev) => {
          const merged = [...prev];
          proposals.forEach((proposal) => {
            const existingIndex = merged.findIndex((entry) => entry.filePath === proposal.filePath);
            if (existingIndex >= 0) {
              merged[existingIndex] = proposal;
            } else {
              merged.push(proposal);
            }
          });
          return merged;
        });
        setPendingSnapshotId(null);
        setQualityGatePassedBatch(false);
        focusPendingChange(proposals[0]);
        showMessage(`${proposals.length} changement(s) IA en attente d'application.`, 3200);
      }

      const diffErrors = [];
      const diffSectionRegex = /(?:^|\n)FILE:\s*(.+?)\s*\r?\n([\s\S]*?)(?=(?:\r?\nFILE:\s*)|$)/g;
      let sectionMatch;

      while ((sectionMatch = diffSectionRegex.exec(aiResponse)) !== null) {
        const fileName = sanitizeProposedFilePath(sectionMatch[1]);
        const sectionBody = String(sectionMatch[2] || '');
        if (!fileName) continue;

        const diffBlockRegex = /<<<<\s*SEARCH\s*\r?\n([\s\S]*?)\r?\n====\s*\r?\n([\s\S]*?)\r?\n>>>>\s*REPLACE/g;
        let diffMatch;
        const blocks = [];
        while ((diffMatch = diffBlockRegex.exec(sectionBody)) !== null) {
          blocks.push({
            search: String(diffMatch[1] ?? ''),
            replace: String(diffMatch[2] ?? '')
          });
        }

        if (blocks.length === 0) continue;
        if (!currentProjectPath) {
          diffErrors.push(`[${fileName}] Projet non disponible pour appliquer le diff.`);
          continue;
        }

        try {
          const readRes = await window.electronAPI.readFile(currentProjectPath, fileName);
          if (!readRes?.success) {
            diffErrors.push(`[${fileName}] Impossible de lire le fichier cible.`);
            continue;
          }

          let nextContent = String(readRes.content || '');
          let blockError = '';

          for (const block of blocks) {
            if (!nextContent.includes(block.search)) {
              blockError = `[${fileName}] Bloc SEARCH introuvable dans le fichier cible.`;
              break;
            }
            nextContent = nextContent.replace(block.search, block.replace);
          }

          if (blockError) {
            diffErrors.push(blockError);
            continue;
          }

          const proposal = await buildFileProposal(fileName, nextContent);
          if (proposal) {
            setPendingFileChanges((prev) => {
              const next = prev.filter((entry) => entry.filePath !== proposal.filePath);
              return [...next, proposal];
            });
            setPendingSnapshotId(null);
            setQualityGatePassedBatch(false);
            focusPendingChange(proposal);
          }
        } catch (error) {
          diffErrors.push(`[${fileName}] ${error.message}`);
        }
      }

      if (diffErrors.length > 0) {
        showMessage(`Diff IA partiellement rejeté: ${diffErrors[0]}`, 5000);
      }
    } catch (error) {
      showMessage(`Erreur traitement fichiers IA: ${error.message}`, 5000);
    }
  }, [buildFileProposal, currentProjectPath, focusPendingChange, sanitizeProposedFilePath, showMessage]);

  const resetPendingChangesState = useCallback(() => {
    setPreviousCode('');
    setPendingFileChanges([]);
    setActivePendingChangeId(null);
    setPendingSnapshotId(null);
    setAppliedPatchHistory([]);
    setQualityGatePassedBatch(false);
    setIsDiffMode(false);
  }, []);

  const handleUndo = useCallback(async () => {
    if (Array.isArray(pendingFileChanges) && pendingFileChanges.length > 0) {
      const idxFromActiveId = pendingFileChanges.findIndex((change) => change.id === activePendingChangeId);
      const idxFromActiveFile = idxFromActiveId >= 0
        ? idxFromActiveId
        : pendingFileChanges.findIndex((change) => change.filePath === activeFile);
      const nextIndex = idxFromActiveFile >= 0 ? idxFromActiveFile : 0;
      rejectPendingChangeByIndex(nextIndex);
      return 'pending-rejected';
    }

    if (Array.isArray(appliedPatchHistory) && appliedPatchHistory.length > 0) {
      const lastPatch = appliedPatchHistory[appliedPatchHistory.length - 1];
      const rollbackRes = await rollbackPatchEntry(lastPatch);
      if (rollbackRes?.success) {
        setAppliedPatchHistory((prev) => prev.slice(0, -1));
        await loadProjectItems();

        if (activeFile === lastPatch.filePath) {
          setCode(lastPatch.existedBefore ? (lastPatch.previousContent || '') : '');
        }
        setPreviousCode('');
        setIsDiffMode(false);
        showMessage(`Rollback patch ${lastPatch.patchId} applique.`, 3200);
        return 'rollback-applied';
      }
      showMessage(`Rollback impossible: ${rollbackRes?.error || 'conflit detecte'}`, 5000);
      return 'rollback-failed';
    }

    if (previousCode !== '' && activeFile && currentProjectPath) {
      try {
        const response = await window.electronAPI.writeFile(currentProjectPath, activeFile, previousCode);
        if (response.success) {
          setCode(previousCode);
          setPreviousCode('');
          setIsDiffMode(false);
          showMessage('Modification annulee.');
          return 'single-undo';
        }
      } catch (error) {
        showMessage(`Erreur: ${error.message}`, 5000);
      }
    }

    return 'noop';
  }, [
    activeFile,
    activePendingChangeId,
    appliedPatchHistory,
    currentProjectPath,
    loadProjectItems,
    pendingFileChanges,
    previousCode,
    rejectPendingChangeByIndex,
    rollbackPatchEntry,
    setCode,
    showMessage
  ]);

  const handleAcceptDiff = useCallback(async () => {
    if (Array.isArray(pendingFileChanges) && pendingFileChanges.length > 0) {
      const idxFromActiveId = pendingFileChanges.findIndex((change) => change.id === activePendingChangeId);
      const idxFromActiveFile = idxFromActiveId >= 0
        ? idxFromActiveId
        : pendingFileChanges.findIndex((change) => change.filePath === activeFile);
      const nextIndex = idxFromActiveFile >= 0 ? idxFromActiveFile : 0;
      return await applyPendingChangeByIndex(nextIndex) ? 'pending-applied' : 'pending-failed';
    }

    setIsDiffMode(false);
    setPreviousCode('');
    showMessage('Modifications acceptees.');
    return 'accepted';
  }, [
    activeFile,
    activePendingChangeId,
    applyPendingChangeByIndex,
    pendingFileChanges,
    showMessage
  ]);

  const selectPendingChangeByIndex = useCallback((index) => {
    if (!Array.isArray(pendingFileChanges) || pendingFileChanges.length === 0) return false;
    const change = pendingFileChanges[index];
    if (!change) return false;
    focusPendingChange(change);
    return true;
  }, [focusPendingChange, pendingFileChanges]);

  return {
    previousCode,
    setPreviousCode,
    isDiffMode,
    setIsDiffMode,
    pendingFileChanges,
    activePendingChangeId,
    pendingSnapshotId,
    processAIFileModifications,
    applyPendingChangeByIndex,
    rejectPendingChangeByIndex,
    applyAllPendingChanges,
    rejectAllPendingChanges,
    handleUndo,
    handleAcceptDiff,
    selectPendingChangeByIndex,
    resetPendingChangesState
  };
};

export default useAIPendingChanges;
