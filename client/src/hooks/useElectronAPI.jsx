import { useState, useEffect, useCallback } from 'react';

export const useElectronAPI = () => {
  const [isAvailable, setIsAvailable] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    const checkAPI = typeof window.electronAPI !== 'undefined';
    setIsAvailable(checkAPI);
    
    if (!checkAPI) {
      const timeout = setTimeout(() => {
        setMessage("Attention: L'application ne semble pas s'exécuter dans un environnement Electron. Les fonctionnalités de fichier et l'API Gemini ne seront pas disponibles.");
      }, 1000);
      return () => clearTimeout(timeout);
    }
  }, []);

  const showMessage = useCallback((text, duration = 3000) => {
    setMessage(text);
    setTimeout(() => setMessage(''), duration);
  }, []);

  return { isAvailable, message, showMessage, setMessage };
};

export default useElectronAPI;
