import React, { useCallback, useState } from 'react';
import './UpdateChecker.css';

const UpdateChecker = ({ isElectronApiAvailable, showMessage }) => {
  const [isChecking, setIsChecking] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [updateAvailable, setUpdateAvailable] = useState(null);

  const handleCheckUpdates = useCallback(async () => {
    if (!isElectronApiAvailable || !window.electronAPI?.getLatestOllamaQwenVersion || !window.electronAPI?.loadSettings) return;
    
    setIsChecking(true);
    try {
      // Fetch latest online
      const onlineRes = await window.electronAPI.getLatestOllamaQwenVersion();
      if (!onlineRes?.success || !onlineRes.version) {
        if (showMessage) showMessage('Impossible de vérifier la dernière version de Qwen.', 3000);
        return;
      }
      const latestVersion = parseFloat(onlineRes.version);

      // Fetch current local
      const settingsRes = await window.electronAPI.loadSettings();
      const currentModels = [
        settingsRes?.settings?.ollamaModel,
        settingsRes?.settings?.ollamaModelArchitect,
        settingsRes?.settings?.ollamaModelCoder,
        settingsRes?.settings?.ollamaModelTester
      ].filter(Boolean);

      // Check if any is outdated
      let hasOutdated = false;
      let outdatedModel = '';
      for (const model of currentModels) {
        const name = model.toLowerCase();
        if (name.includes('qwen')) {
          const match = name.match(/qwen(\d+(\.\d+)?)/);
          if (match && match[1]) {
            const version = parseFloat(match[1]);
            if (version < latestVersion) {
              hasOutdated = true;
              outdatedModel = model;
              break;
            }
          } else if (name === 'qwen' || name.startsWith('qwen:')) {
            hasOutdated = true;
            outdatedModel = model;
            break;
          }
        }
      }

      if (hasOutdated) {
        setUpdateAvailable({ version: onlineRes.version, oldModel: outdatedModel });
        if (showMessage) showMessage(`Mise à jour Qwen ${onlineRes.version} disponible !`, 4000);
      } else {
        setUpdateAvailable(null);
        if (showMessage) showMessage('Vos modèles Qwen sont déjà à jour.', 3000);
      }
    } catch (err) {
      console.error(err);
      if (showMessage) showMessage('Erreur lors de la vérification.', 3000);
    } finally {
      setIsChecking(false);
    }
  }, [isElectronApiAvailable, showMessage]);

  const handleUpdate = useCallback(async () => {
    if (!updateAvailable || !window.electronAPI?.pullOllamaModel) return;
    const targetModel = `qwen${updateAvailable.version}:latest`;
    
    setIsUpdating(true);
    if (showMessage) showMessage(`Téléchargement de Qwen ${updateAvailable.version} lancé. Cela peut prendre quelques minutes...`, 5000);

    try {
      // Pull model
      const response = await window.electronAPI.pullOllamaModel(targetModel);
      if (!response?.success) throw new Error(response?.error);

      // Update settings
      if (window.electronAPI?.loadSettings && window.electronAPI?.saveSettings) {
        const res = await window.electronAPI.loadSettings();
        if (res.success && res.settings) {
          const newSettings = { ...res.settings };
          ['ollamaModel', 'ollamaModelArchitect', 'ollamaModelCoder', 'ollamaModelTester'].forEach(key => {
            if (newSettings[key] === updateAvailable.oldModel) {
              newSettings[key] = targetModel;
            }
          });
          await window.electronAPI.saveSettings(newSettings);
          window.dispatchEvent(new CustomEvent('settings-updated', { detail: newSettings }));
        }
      }
      
      setUpdateAvailable(null);
      if (showMessage) showMessage(`Mise à jour vers Qwen ${updateAvailable.version} réussie !`, 4000);
    } catch (error) {
      console.error(error);
      if (showMessage) showMessage(`Échec de la mise à jour: ${error.message}`, 5000);
    } finally {
      setIsUpdating(false);
    }
  }, [updateAvailable, isElectronApiAvailable, showMessage]);

  if (!isElectronApiAvailable) return null;

  if (updateAvailable) {
    return (
      <button 
        className="btn btn-pill btn-live"
        onClick={handleUpdate}
        disabled={isUpdating}
      >
        {isUpdating ? 'Mise à jour...' : `Installer Qwen ${updateAvailable.version}`}
      </button>
    );
  }

  return (
    <button 
      className="btn btn-ghost"
      onClick={handleCheckUpdates}
      disabled={isChecking}
    >
      {isChecking ? 'Vérification...' : 'Vérifier MAJ Qwen'}
    </button>
  );
};

export default UpdateChecker;
