import React, { useState, useEffect, useRef, useCallback } from 'react';
import './App.css';

// Main App Component
const App = () => {
  // State for the currently opened project folder path
  const [currentProjectPath, setCurrentProjectPath] = useState('');
  // State for the list of items (files/folders) in the current project directory
  const [projectItems, setProjectItems] = useState([]);
  // State for the currently active file's name (relative to currentProjectPath)
  const [activeFile, setActiveFile] = useState('');
  // State for the code editor content (content of activeFile)
  const [code, setCode] = useState('');
  // State to store the code of the active file before the last AI modification, for undo functionality
  const [previousCode, setPreviousCode] = useState('');
  // State for the user's prompt to the AI
  const [prompt, setPrompt] = useState('');
  // State to manage loading indicator during AI generation
  const [isLoading, setIsLoading] = useState(false);
  // Ref for the textarea to control scroll and focus
  const codeEditorRef = useRef(null);
  // State for line numbers, derived from code content
  const [lineNumbers, setLineNumbers] = useState('');
  // State to store the conversation history with the AI
  const [aiConversationHistory, setAiConversationHistory] = useState([]);
  // Ref for the conversation history div to control scroll
  const conversationHistoryRef = useRef(null);
  // State for new file/folder input
  const [newItemName, setNewItemName] = useState('');
  // State for displaying messages to the user (e.g., file saved, error)
  const [message, setMessage] = useState('');
  // State to track if Electron API is available
  const [isElectronApiAvailable, setIsElectronApiAvailable] = useState(false);
  // State for expanded folders
  const [expandedFolders, setExpandedFolders] = useState(new Set());

  // Log initial state of electronAPI on component mount
  useEffect(() => {
    const checkElectronAPI = typeof window.electronAPI !== 'undefined';
    setIsElectronApiAvailable(checkElectronAPI);
    if (!checkElectronAPI) {
      showMessage("Attention: L'application ne semble pas s'exécuter dans un environnement Electron. Les fonctionnalités de fichier et l'API Gemini ne seront pas disponibles.", 15000);
    }
  }, []); // Run only once on mount

  // Function to display a temporary message
  const showMessage = (text, duration = 3000) => {
    setMessage(text);
    setTimeout(() => setMessage(''), duration);
  };

  // Function to load the list of items (files/folders) from the current project path
  const loadProjectItems = useCallback(async () => {
    if (!isElectronApiAvailable || !currentProjectPath) {
      setProjectItems([]); // Clear items if no project path is set or API not available
      return;
    }
    try {
      const response = await window.electronAPI.getAllFiles(currentProjectPath);
      if (response.success) {
        // Sort items: directories first, then files, both alphabetically
        const sortedItems = response.items.sort((a, b) => {
          if (a.type === 'directory' && b.type === 'file') return -1;
          if (a.type === 'file' && b.type === 'directory') return 1;
          return a.name.localeCompare(b.name);
        });
        setProjectItems(sortedItems);
        // If activeFile is no longer in the list, clear it
        const checkFileExists = (items, targetFile) => {
          for (const item of items) {
            if (item.type === 'file' && (item.name === targetFile || item.path === targetFile)) {
              return true;
            }
            if (item.children && item.children.length > 0) {
              if (checkFileExists(item.children, targetFile)) {
                return true;
              }
            }
          }
          return false;
        };
        
        if (activeFile && !checkFileExists(response.items, activeFile)) {
          setActiveFile('');
          setCode('');
        }
      } else {
        showMessage(`Erreur lors du chargement des éléments du projet: ${response.error}`, 5000);
        console.error("Erreur lors du chargement des éléments du projet:", response.error);
      }
    } catch (error) {
      showMessage(`Erreur IPC lors du chargement des éléments du projet: ${error.message}`, 5000);
      console.error("Erreur IPC lors du chargement des éléments du projet:", error);
    }
  }, [currentProjectPath, activeFile, isElectronApiAvailable]);

  // Effect to load project items when currentProjectPath changes
  useEffect(() => {
    loadProjectItems();
  }, [currentProjectPath, loadProjectItems]);
  
  // Fonction pour charger les enfants d'un dossier
  const loadFolderChildren = async (folderPath, itemPath) => {
    try {
      const response = await window.electronAPI.getFolderChildren(folderPath);
      if (response.success) {
        // Mettre à jour l'arbre avec les enfants chargés
        setProjectItems(prevItems => {
          const updateItemChildren = (items) => {
            return items.map(item => {
              if (item.path === itemPath) {
                return { ...item, children: response.children };
              } else if (item.children && item.children.length > 0) {
                return { ...item, children: updateItemChildren(item.children) };
              }
              return item;
            });
          };
          return updateItemChildren(prevItems);
        });
      }
    } catch (error) {
      console.error('Erreur lors du chargement des enfants du dossier:', error);
    }
  };
  
  // Fonction pour basculer l'expansion d'un dossier
  const toggleFolderExpansion = async (item) => {
    const newExpandedFolders = new Set(expandedFolders);
    
    if (expandedFolders.has(item.path)) {
      // Replier le dossier
      newExpandedFolders.delete(item.path);
    } else {
      // Déplier le dossier
      newExpandedFolders.add(item.path);
      
      // Charger les enfants si pas encore chargés
      if (item.children.length === 0 && item.hasChildren) {
        await loadFolderChildren(item.fullPath, item.path);
      }
    }
    
    setExpandedFolders(newExpandedFolders);
  };
  
  // Fonction pour rendre l'arborescence des fichiers
  const renderTreeItems = (items, depth = 0) => {
    return items.map((item) => {
      const isExpanded = expandedFolders.has(item.path);
      const paddingLeft = depth * 20;
      
      return (
        <div key={item.path || item.name}>
          <div 
            className="file-item flex items-center justify-between group rounded-lg transition-all duration-200 ease-in-out"
            style={{ paddingLeft: `${paddingLeft}px` }}
          >
            <div className="flex items-center flex-grow">
              {item.type === 'directory' && (
                <button
                  onClick={() => toggleFolderExpansion(item)}
                  className="p-1 mr-1 hover:bg-gray-600 rounded transition-colors"
                >
                  <svg 
                    className={`h-3 w-3 text-gray-400 transition-transform duration-200 ${
                      isExpanded ? 'transform rotate-90' : ''
                    }`} 
                    fill="none" 
                    viewBox="0 0 24 24" 
                    stroke="currentColor"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              )}
              
              <button 
                onClick={() => {
                  if (item.type === 'file') {
                    // Utiliser le chemin complet pour les fichiers dans les sous-dossiers
                    const fullPath = item.path || item.name;
                    setActiveFile(fullPath);
                    console.log('Ouverture du fichier:', fullPath);
                  } else {
                    toggleFolderExpansion(item);
                  }
                }}
                className={`flex-grow text-left p-2 rounded-lg text-sm flex items-center ${
                  activeFile === (item.path || item.name) 
                    ? 'bg-gradient-to-r from-blue-600 to-purple-600 text-white shadow-lg' 
                    : 'hover:bg-gray-700/50 text-gray-200'
                }`}
              >
                {item.type === 'directory' ? (
                  <svg className="h-4 w-4 mr-2 text-yellow-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                  </svg>
                ) : (
                  <svg className="h-4 w-4 mr-2 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                )}
                <span className="truncate">{item.name}</span>
              </button>
            </div>
            
            <button 
              onClick={() => deleteItem(item.name, item.type)} 
              className="ml-2 p-1 rounded-full text-gray-500 hover:bg-red-500 hover:text-white opacity-0 group-hover:opacity-100 transition-opacity"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
          </div>
          
          {/* Render children if folder is expanded */}
          {item.type === 'directory' && isExpanded && item.children && item.children.length > 0 && (
            <div className="ml-2">
              {renderTreeItems(item.children, depth + 1)}
            </div>
          )}
        </div>
      );
    });
  };

  // Effect to load active file content into the editor when activeFile changes
  useEffect(() => {
    const loadFileContent = async () => {
      if (activeFile && currentProjectPath) {
        if (!isElectronApiAvailable) {
          return;
        }
        try {
          const response = await window.electronAPI.readFile(currentProjectPath, activeFile);
          if (response.success) {
            setCode(response.content);
            setPreviousCode(''); // Reset undo history when switching files
            showMessage(`Fichier "${activeFile}" chargé.`, 2000);
          } else {
            setCode(''); // Clear editor if file cannot be read
            showMessage(`Erreur lors du chargement de "${activeFile}": ${response.error}`, 5000);
            console.error(`Erreur lors du chargement de "${activeFile}":`, response.error);
          }
        } catch (error) {
          showMessage(`Erreur IPC lors du chargement de "${activeFile}": ${error.message}`, 5000);
          console.error(`Erreur IPC lors du chargement de "${activeFile}":`, error);
        }
      } else {
        setCode(''); // Clear editor if no file is active or no project path
      }
    };
    loadFileContent();
  }, [activeFile, currentProjectPath, isElectronApiAvailable]);

  // Effect to update line numbers whenever the code changes
  useEffect(() => {
    const lines = code.split('\n');
    const numbers = lines.map((_, index) => index + 1).join('\n');
    setLineNumbers(numbers);
  }, [code]);

  // Effect to scroll conversation history to bottom when new message arrives
  useEffect(() => {
    if (conversationHistoryRef.current) {
      conversationHistoryRef.current.scrollTop = conversationHistoryRef.current.scrollHeight;
    }
  }, [aiConversationHistory]);

  // Handle changes in the code editor and save the active file's content to the system
  const handleCodeChange = async (e) => {
    const newCode = e.target.value;
    setCode(newCode);
    if (!isElectronApiAvailable || !activeFile || !currentProjectPath) {
      return;
    }
    // Save the file automatically after a small delay to avoid too many writes
    try {
      const response = await window.electronAPI.writeFile(currentProjectPath, activeFile, newCode);
      if (!response.success) {
        showMessage(`Erreur lors de la sauvegarde de "${activeFile}": ${response.error}`, 3000);
        console.error(`Erreur lors de la sauvegarde de "${activeFile}":`, response.error);
      }
    } catch (error) {
      showMessage(`Erreur IPC lors de la sauvegarde de "${activeFile}": ${error.message}`, 3000);
      console.error(`Erreur IPC lors de la sauvegarde de "${activeFile}":`, error);
    }
  };

  // Handle changes in the AI prompt input
  const handlePromptChange = (e) => {
    setPrompt(e.target.value);
  };

  // Function to call the Gemini API and get AI response
  const generateAIResponse = async () => {
    if (!prompt.trim()) {
      showMessage("Veuillez entrer une requête pour l'IA.");
      return;
    }
    if (!currentProjectPath) {
      showMessage("Veuillez ouvrir un dossier de projet avant de demander à l'IA.");
      return;
    }
    if (!isElectronApiAvailable) {
      showMessage("Erreur: L'application ne s'exécute pas dans un environnement Electron. L'API Gemini n'est pas disponible.", 10000);
      return;
    }

    setIsLoading(true);
    
    setPreviousCode(code); // Save current code for undo on the active file

    // Add user prompt to conversation history
    const updatedHistory = [...aiConversationHistory, { role: 'user', text: prompt }];
    setAiConversationHistory(updatedHistory);
    setPrompt(''); // Clear prompt input after sending


    try {
      // Lire tous les fichiers du projet pour fournir le contexte complet à l'IA
      showMessage("Lecture du contexte du projet...", 2000);
      const projectFilesResponse = await window.electronAPI.getAllProjectFiles(currentProjectPath);
      
      let allProjectFiles = null;
      if (projectFilesResponse.success) {
        allProjectFiles = projectFilesResponse;
        const fileCount = Object.keys(projectFilesResponse.files).length;
        showMessage(`Contexte du projet lu: ${fileCount} fichiers analysés`, 2000);
      } else {
        showMessage(`Erreur lors de la lecture du projet: ${projectFilesResponse.error}`, 3000);
        console.warn('Impossible de lire le contexte du projet:', projectFilesResponse.error);
      }
      
      // Call the Electron IPC handler for Gemini completion with full project context
      const response = await window.electronAPI.getGeminiCompletion(updatedHistory, code, allProjectFiles);

      // Check if the response contains valid content
      if (response.success) {
        const fullAiText = response.text;
        

        // Add full AI response to conversation history
        setAiConversationHistory(prevHistory => [...prevHistory, { role: 'model', text: fullAiText }]);

        // Nouvelle logique avancée pour détecter et appliquer les modifications de fichiers
        console.log('Traitement de la réponse IA:', fullAiText.substring(0, 200) + '...');
        await processAIFileModifications(fullAiText);
        
        // Sauvegarde automatique de la conversation
        await autoSaveConversation();
        
        // Scroll to the bottom of the conversation
        if (conversationHistoryRef.current) {
          conversationHistoryRef.current.scrollTop = conversationHistoryRef.current.scrollHeight;
        }

      } else {
        setAiConversationHistory(prevHistory => [...prevHistory, { role: 'model', text: `Erreur de l'IA: ${response.error}` }]);
        console.error("Erreur de l'API Gemini:", response.error);
      }
    } catch (error) {
      console.error("Erreur lors de l'appel à l'API Gemini:", error);
      
      setAiConversationHistory(prevHistory => [...prevHistory, { role: 'model', text: "Erreur lors de la communication avec l'IA. Veuillez réessayer." }]);
    } finally {
      setIsLoading(false);
    }
  };

  // Fonction pour sauvegarder la conversation actuelle
  const saveConversation = async () => {
    if (!currentProjectPath || aiConversationHistory.length === 0) {
      showMessage("Aucune conversation à sauvegarder ou aucun projet ouvert.", 3000);
      return;
    }
    
    if (!isElectronApiAvailable) {
      showMessage("Erreur: L'application ne s'exécute pas dans un environnement Electron.", 5000);
      return;
    }
    
    try {
      const response = await window.electronAPI.saveConversation(currentProjectPath, aiConversationHistory);
      if (response.success) {
        showMessage(`Conversation sauvegardée: ${response.fileName}`, 4000);
        setAiConversationHistory(prevHistory => [...prevHistory, { 
          role: 'system', 
          text: `💾 Conversation sauvegardée dans: conversations/${response.fileName}` 
        }]);
      } else {
        showMessage(`Erreur lors de la sauvegarde: ${response.error}`, 5000);
      }
    } catch (error) {
      console.error('Erreur lors de la sauvegarde:', error);
      showMessage(`Erreur lors de la sauvegarde: ${error.message}`, 5000);
    }
  };

  // Sauvegarde automatique après chaque réponse de l'IA (optionnel)
  const autoSaveConversation = async () => {
    if (currentProjectPath && aiConversationHistory.length >= 4) { // Au moins 2 échanges
      try {
        await window.electronAPI.saveConversation(currentProjectPath, aiConversationHistory);
      } catch (error) {
        console.warn('Erreur lors de la sauvegarde automatique:', error);
      }
    }
  };

  // Fonction pour traiter les modifications de fichiers proposées par l'IA
  const processAIFileModifications = async (aiResponse) => {
    try {
      let modificationsApplied = 0;
      
      // Format 1: **FICHIER: nom_fichier.ext** suivi d'un bloc de code
      const fileBlockRegex1 = /\*\*FICHIER:\s*([^*\n]+)\*\*\s*```([\w]*)?\s*([\s\S]*?)```/gi;
      
      // Format 2: **FICHIER: nom_fichier.ext** suivi de code sans backticks
      const fileBlockRegex2 = /\*\*FICHIER:\s*([^*\n]+)\*\*\s*([\s\S]*?)(?=\*\*FICHIER:|$)/gi;
      
      // Essayer le format 1 d'abord (avec backticks)
      let match;
      while ((match = fileBlockRegex1.exec(aiResponse)) !== null) {
        const fileName = match[1].trim();
        const language = match[2] || '';
        const fileContent = match[3].trim();
        
        console.log('Format 1 détecté:', { fileName, language, contentLength: fileContent.length });
        
        if (fileName && fileContent) {
          const success = await createOrUpdateFile(fileName, fileContent);
          if (success) modificationsApplied++;
        }
      }
      
      // Si aucun match avec le format 1, essayer le format 2 (sans backticks)
      if (modificationsApplied === 0) {
        fileBlockRegex2.lastIndex = 0; // Reset regex
        while ((match = fileBlockRegex2.exec(aiResponse)) !== null) {
          const fileName = match[1].trim();
          let fileContent = match[2].trim();
          
          // Nettoyer le contenu (enlever les lignes vides au début/fin)
          fileContent = fileContent.replace(/^\s*\n+|\n+\s*$/g, '');
          
          console.log('Format 2 détecté:', { fileName, contentLength: fileContent.length });
          
          if (fileName && fileContent) {
            const success = await createOrUpdateFile(fileName, fileContent);
            if (success) modificationsApplied++;
          }
        }
      }
      
      // Si toujours aucune modification, chercher des blocs de code simples
      if (modificationsApplied === 0) {
        const simpleCodeRegex = /```([\w]*)?\s*([\s\S]*?)```/g;
        let codeMatch;
        let hasCode = false;
        
        while ((codeMatch = simpleCodeRegex.exec(aiResponse)) !== null) {
          hasCode = true;
          const codeContent = codeMatch[2].trim();
          
          if (activeFile && codeContent) {
            // Ajouter le code au fichier actif
            const newContent = code + '\n\n' + codeContent;
            const writeResp = await window.electronAPI.writeFile(currentProjectPath, activeFile, newContent);
            if (writeResp.success) {
              setCode(newContent);
              setAiConversationHistory(prevHistory => [...prevHistory, { 
                role: 'system', 
                text: `✓ Code ajouté au fichier "${activeFile}"` 
              }]);
            }
            break; // Ne traiter que le premier bloc de code
          }
        }
        
        if (!hasCode) {
          // Ne pas ajouter de message système si pas de code détecté
          console.log('Aucun bloc de code détecté dans la réponse IA');
        }
      } else {
        showMessage(`${modificationsApplied} fichier(s) modifié(s) automatiquement par l'IA`, 4000);
      }
      
    } catch (error) {
      console.error('Erreur lors du traitement des modifications IA:', error);
      setAiConversationHistory(prevHistory => [...prevHistory, { 
        role: 'system', 
        text: `✗ Erreur lors du traitement des modifications: ${error.message}` 
      }]);
    }
  };
  
  // Fonction helper pour créer ou mettre à jour un fichier
  const createOrUpdateFile = async (fileName, fileContent) => {
    try {
      // Nettoyer le nom du fichier (enlever caractères invalides)
      const cleanFileName = fileName
        .replace(/[()]/g, '') // Enlever parenthèses
        .replace(/\s+/g, '_') // Remplacer espaces par underscores
        .replace(/[<>:"|?*]/g, '') // Enlever caractères Windows invalides
        .trim();
      
      console.log(`Nom de fichier nettoyé: "${fileName}" -> "${cleanFileName}"`);
      
      // Vérifier si le fichier existe
      const fileExists = projectItems.some(item => item.name === cleanFileName && item.type === 'file');
      
      if (fileExists) {
        // Modifier le fichier existant
        const writeResp = await window.electronAPI.writeFile(currentProjectPath, cleanFileName, fileContent);
        if (writeResp.success) {
          // Actualiser l'arborescence au cas où des dossiers ont été créés
          await loadProjectItems();
          
          setAiConversationHistory(prevHistory => [...prevHistory, { 
            role: 'system', 
            text: `✓ Fichier "${cleanFileName}" modifié automatiquement par l'IA` 
          }]);
          
          // Si c'est le fichier actif, mettre à jour l'éditeur
          if (activeFile === cleanFileName) {
            setCode(fileContent);
          }
          return true;
        } else {
          setAiConversationHistory(prevHistory => [...prevHistory, { 
            role: 'system', 
            text: `✗ Erreur lors de la modification de "${cleanFileName}": ${writeResp.error}` 
          }]);
          return false;
        }
      } else {
        // Créer un nouveau fichier avec dossiers parents
        const createResp = await window.electronAPI.createNewFile(currentProjectPath, cleanFileName, fileContent);
        if (createResp.success) {
          // Recharger la liste des fichiers pour actualiser l'arborescence
          await loadProjectItems();
          
          setAiConversationHistory(prevHistory => [...prevHistory, { 
            role: 'system', 
            text: `✓ Nouveau fichier "${cleanFileName}" créé automatiquement par l'IA` 
          }]);
          
          // Optionnellement, ouvrir le nouveau fichier
          if (!activeFile) {
            setActiveFile(cleanFileName);
            setCode(fileContent);
          }
          
          // Actualiser l'affichage avec un petit délai pour s'assurer que le fichier est bien créé
          setTimeout(async () => {
            await loadProjectItems();
          }, 500);
          
          return true;
        } else {
          setAiConversationHistory(prevHistory => [...prevHistory, { 
            role: 'system', 
            text: `✗ Erreur lors de la création de "${cleanFileName}": ${createResp.error}` 
          }]);
          return false;
        }
      }
    } catch (error) {
      console.error(`Erreur lors du traitement du fichier ${fileName}:`, error);
      setAiConversationHistory(prevHistory => [...prevHistory, { 
        role: 'system', 
        text: `✗ Erreur lors du traitement de "${fileName}": ${error.message}` 
      }]);
      return false;
    }
  };

  // Function to undo the last AI code modification for the active file
  const handleUndo = async () => {
    if (previousCode !== '') {
      if (!isElectronApiAvailable || !currentProjectPath || !activeFile) {
        showMessage("Erreur: L'application ne s'exécute pas dans un environnement Electron ou aucun fichier/projet n'est actif. L'annulation n'est pas possible.", 10000);
        return;
      }
      try {
        const response = await window.electronAPI.writeFile(currentProjectPath, activeFile, previousCode);
        if (response.success) {
          setCode(previousCode);
          setPreviousCode(''); // Clear previous code after undo
          // Modification annulée avec succès
          setAiConversationHistory(prevHistory => [...prevHistory, { role: 'system', text: "Modification de l'IA annulée." }]);
          showMessage("Modification de l'IA annulée.");
        } else {
          showMessage(`Erreur lors de l'annulation de la modification: ${response.error}`, 5000);
          console.error(`Erreur lors de l'annulation de la modification:`, response.error);
        }
      } catch (error) {
        showMessage(`Erreur IPC lors de l'annulation de la modification: ${error.message}`, 5000);
        console.error(`Erreur IPC lors de l'annulation de la modification:`, error);
      }
    }
  };

  // Function to create a new file or directory on the system
  const createNewItem = async (type) => {
    const itemName = newItemName.trim();
    if (!itemName) {
      showMessage(`Veuillez entrer un nom pour le nouveau ${type === 'file' ? 'fichier' : 'dossier'}.`);
      return;
    }
    if (!currentProjectPath) {
      showMessage("Veuillez d'abord ouvrir un dossier de projet.", 5000);
      return;
    }
    if (projectItems.some(item => item.name === itemName)) {
      showMessage(`Un élément nommé "${itemName}" existe déjà dans ce projet.`);
      return;
    }
    if (!isElectronApiAvailable) {
      showMessage("Erreur: L'application ne s'exécute pas dans un environnement Electron. La création n'est pas possible.", 10000);
      return;
    }

    try {
      let response;
      if (type === 'file') {
        response = await window.electronAPI.createNewFile(currentProjectPath, itemName, ''); // Create empty file
      } else { // type === 'directory'
        response = await window.electronAPI.createDirectory(currentProjectPath, itemName);
      }
      
      if (response.success) {
        await loadProjectItems(); // Reload project items
        if (type === 'file') {
          setActiveFile(itemName); // Set new file as active
        }
        setNewItemName(''); // Clear input
        showMessage(`${type === 'file' ? 'Fichier' : 'Dossier'} "${itemName}" créé avec succès.`);
      } else {
        showMessage(`Erreur lors de la création du ${type === 'file' ? 'fichier' : 'dossier'} "${itemName}": ${response.error}`, 5000);
        console.error(`Erreur lors de la création du ${type === 'file' ? 'fichier' : 'dossier'} "${itemName}":`, response.error);
      }
    } catch (error) {
      showMessage(`Erreur IPC lors de la création: ${error.message}`, 5000);
      console.error(`Erreur IPC lors de la création:`, error);
    }
  };

  // Function to delete a file or directory from the system
  const deleteItem = async (itemNameToDelete, type) => {
    if (window.confirm(`Êtes-vous sûr de vouloir supprimer ${type === 'file' ? 'le fichier' : 'le dossier'} "${itemNameToDelete}" ? Cette action est irréversible.`)) {
      if (!isElectronApiAvailable || !currentProjectPath) {
        showMessage("Erreur: L'application ne s'exécute pas dans un environnement Electron ou aucun projet n'est actif. La suppression n'est pas possible.", 10000);
        return;
      }
      try {
        let response;
        if (type === 'file') {
          response = await window.electronAPI.deleteFile(currentProjectPath, itemNameToDelete);
        } else { // type === 'directory'
          response = await window.electronAPI.deleteDirectory(currentProjectPath, itemNameToDelete);
        }

        if (response.success) {
          await loadProjectItems(); // Reload project items
          if (activeFile === itemNameToDelete && type === 'file') {
            setActiveFile(''); // Clear active file if it was deleted
          }
          showMessage(`${type === 'file' ? 'Fichier' : 'Dossier'} "${itemNameToDelete}" supprimé.`);
        } else {
          showMessage(`Erreur lors de la suppression de ${type === 'file' ? 'le fichier' : 'le dossier'} "${itemNameToDelete}": ${response.error}`, 5000);
          console.error(`Erreur lors de la suppression de ${type === 'file' ? 'le fichier' : 'le dossier'} "${itemNameToDelete}":`, response.error);
        }
      } catch (error) {
        showMessage(`Erreur IPC lors de la suppression: ${error.message}`, 5000);
        console.error(`Erreur IPC lors de la suppression:`, error);
      }
    }
  };

  // Function to open a folder dialog and set the project path
  const handleOpenFolder = async () => {
    if (!isElectronApiAvailable) {
      showMessage("Erreur: L'application ne s'exécute pas dans un environnement Electron. L'ouverture de dossier n'est pas possible.", 10000);
      return;
    }
    try {
      const response = await window.electronAPI.openFolderDialog();
      if (response.success && response.path) {
        setCurrentProjectPath(response.path);
        setActiveFile(''); // Clear active file when opening a new folder
        setAiConversationHistory([]); // Clear conversation history for new project
        showMessage(`Dossier de projet ouvert: "${response.path}"`);
      } else if (response.error) {
        showMessage(`Erreur lors de l'ouverture du dossier: ${response.error}`, 5000);
        console.error("Erreur lors de l'ouverture du dossier:", response.error);
      } else {
        showMessage("Ouverture du dossier annulée.");
      }
    } catch (error) {
      showMessage(`Erreur IPC lors de l'ouverture du dossier: ${error.message}`, 5000);
      console.error(`Erreur IPC lors de l'ouverture du dossier:`, error);
    }
  };


  return (
    <div className="app-background min-h-screen text-gray-100 font-mono relative overflow-hidden flex flex-col">
      {/* Effet de particules en arrière-plan */}
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

      {/* Message Display */}
      {message && (
        <div className="message-slide fixed top-4 right-4 bg-gradient-to-r from-blue-600 to-purple-600 text-white px-6 py-3 rounded-lg shadow-2xl z-50 border border-blue-400">
          <div className="flex items-center space-x-2">
            <div className="w-2 h-2 bg-white rounded-full animate-pulse"></div>
            <span className="font-medium">{message}</span>
          </div>
        </div>
      )}

      {/* Main content area */}
      <div className="flex-grow w-full flex flex-row space-x-4 p-4">
        {/* Left Panel: File Explorer */}
        <div className="flex flex-col w-1/4 glass-effect p-4 rounded-2xl border border-gray-700 shadow-2xl">
          <div className="flex items-center space-x-3 mb-4">
            <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-purple-600 rounded-lg flex items-center justify-center shadow-lg">
              <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2H5a2 2 0 00-2-2z" />
              </svg>
            </div>
            <h3 className="text-2xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-purple-400">Projet</h3>
          </div>
          <button
            onClick={handleOpenFolder}
            className="btn-hover-effect focus-ring w-full bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-white font-bold py-3 px-4 rounded-xl shadow-lg transition-all duration-300 ease-in-out transform hover:scale-105 mb-4 text-md flex items-center justify-center space-x-2"
            disabled={!isElectronApiAvailable}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 9l5-5 5 5M12 4v12" />
            </svg>
            <span>Ouvrir un Dossier</span>
          </button>

          {currentProjectPath && (
            <div className="mb-4 p-3 glass-effect rounded-xl text-gray-300 text-sm break-words border border-gray-700">
              <div className="flex items-center space-x-2 mb-1">
                <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
                <span className="font-semibold text-transparent bg-clip-text bg-gradient-to-r from-green-400 to-blue-400">Dossier Actif</span>
              </div>
              <div className="text-white font-medium truncate">{currentProjectPath.split(window.electronAPI ? window.electronAPI.pathSeparator : '/').pop()}</div>
            </div>
          )}

          <div className="flex-grow flex flex-col overflow-hidden">
            {currentProjectPath && (
              <div className="mb-4 border-t border-gray-700 pt-4">
                <div className="relative mb-2">
                  <input
                    type="text"
                    className="focus-ring w-full p-3 pl-10 rounded-xl glass-effect text-gray-100 border border-gray-600 placeholder-gray-400 text-sm"
                    placeholder="Nouveau fichier/dossier..."
                    value={newItemName}
                    onChange={(e) => setNewItemName(e.target.value)}
                    onKeyPress={(e) => { if (e.key === 'Enter' && newItemName) createNewItem(newItemName.includes('.') ? 'file' : 'directory'); }}
                  />
                  <svg className="w-5 h-5 text-gray-400 absolute top-1/2 left-3 transform -translate-y-1/2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                  </svg>
                </div>
                <div className="flex space-x-2">
                  <button onClick={() => createNewItem('file')} className="btn-hover-effect focus-ring flex-1 bg-gradient-to-r from-green-500 to-teal-500 text-white font-bold py-2 px-2 rounded-lg shadow-md text-xs flex items-center justify-center space-x-1" disabled={!isElectronApiAvailable || !newItemName}><span>Fichier</span></button>
                  <button onClick={() => createNewItem('directory')} className="btn-hover-effect focus-ring flex-1 bg-gradient-to-r from-purple-500 to-indigo-500 text-white font-bold py-2 px-2 rounded-lg shadow-md text-xs flex items-center justify-center space-x-1" disabled={!isElectronApiAvailable || !newItemName}><span>Dossier</span></button>
                </div>
              </div>
            )}
            <div className="flex-grow overflow-y-auto custom-scrollbar pr-2">
              {!currentProjectPath ? (
                <div className="text-center text-gray-400 p-6 rounded-lg"><p>Ouvrez un dossier</p></div>
              ) : projectItems.length === 0 ? (
                <div className="text-center text-gray-400 p-6 rounded-lg"><p>Dossier vide</p></div>
              ) : (
                <div className="tree-view">
                  {renderTreeItems(projectItems, 0)}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Middle Panel: Code Editor */}
        <div className="flex flex-col flex-grow w-1/2 glass-effect rounded-2xl border border-gray-700 shadow-2xl overflow-hidden code-editor">
          <div className="bg-black bg-opacity-20 text-gray-300 p-3 text-center font-semibold text-md border-b border-gray-700">
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-gray-400 to-white">Éditeur : </span>
            <span className="text-cyan-400">{activeFile ? activeFile : 'Aucun fichier ouvert'}</span>
          </div>
          <div className="flex flex-row flex-grow">
            <textarea className="w-14 line-numbers text-gray-500 p-4 text-right resize-none outline-none font-mono text-sm leading-6 custom-scrollbar" value={lineNumbers} readOnly />
            <textarea ref={codeEditorRef} className="flex-grow p-4 bg-transparent text-gray-100 outline-none font-mono text-sm leading-6 resize-none custom-scrollbar" value={code} onChange={handleCodeChange} placeholder="Sélectionnez un fichier..." disabled={!activeFile} />
          </div>
          {activeFile && previousCode && <button onClick={handleUndo} className="btn-hover-effect focus-ring bg-yellow-600 hover:bg-yellow-700 text-white font-bold py-2 text-sm">Annuler la modif. IA</button>}
        </div>

        {/* Right Panel: AI Prompt & Conversation */}
        <div className="flex flex-col w-1/4 glass-effect p-4 rounded-2xl border border-gray-700 shadow-2xl">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center space-x-3">
              <div className="w-8 h-8 bg-gradient-to-br from-green-400 to-cyan-500 rounded-lg flex items-center justify-center shadow-lg"><svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.293 2.293a1 1 0 010 1.414L11 12l4.293 4.293a1 1 0 01-1.414 1.414L10 13.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 12 4.293 7.707a1 1 0 011.414-1.414L10 10.586l4.293-4.293a1 1 0 011.414 0z"></path></svg></div>
              <label htmlFor="ai-prompt" className="text-xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-green-400 to-cyan-400">Agent IA</label>
            </div>
            <button 
              onClick={saveConversation}
              className="btn-hover-effect focus-ring bg-gradient-to-r from-blue-500 to-indigo-600 text-white font-bold py-1 px-3 rounded-lg shadow-md text-xs flex items-center space-x-1"
              disabled={!currentProjectPath || aiConversationHistory.length === 0 || !isElectronApiAvailable}
              title="Sauvegarder la conversation"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3-3m0 0l-3 3m3-3v12" />
              </svg>
              <span>Sauver</span>
            </button>
          </div>
          <textarea id="ai-prompt" className="focus-ring w-full bg-black bg-opacity-20 text-gray-100 p-3 rounded-lg border border-gray-600 resize-y text-sm custom-scrollbar mb-3" value={prompt} onChange={handlePromptChange} placeholder="Votre requête..." rows={2} />
          <button onClick={generateAIResponse} className="btn-hover-effect focus-ring bg-gradient-to-r from-green-500 to-cyan-600 text-white font-bold py-3 px-4 rounded-lg shadow-lg text-md" disabled={isLoading || !currentProjectPath || !isElectronApiAvailable}>
            {isLoading ? <span className="flex items-center justify-center"><svg className="animate-spin h-5 w-5 mr-3" viewBox="0 0 24 24"></svg>Génération...</span> : 'Envoyer à l\'IA'}
          </button>
          <div ref={conversationHistoryRef} className="flex-grow bg-black bg-opacity-20 p-2 rounded-lg text-gray-200 overflow-y-auto custom-scrollbar mt-3 text-sm">
            {aiConversationHistory.map((msg, index) => (
              <div key={index} className={`mb-2 p-2 rounded-md ${msg.role === 'user' ? 'bg-gray-700/50' : 'bg-gray-900/50'}`}>
                <p className="font-bold text-xs text-cyan-400">{msg.role === 'user' ? 'Vous' : (msg.role === 'model' ? 'IA' : 'Système')}</p>
                <p className="whitespace-pre-wrap text-xs">{msg.text}</p>
              </div>
            ))}
            {isLoading && <div className="text-center p-2"><p className="text-xs text-gray-400">L'IA réfléchit...</p></div>}
          </div>
        </div>
      </div>
    </div>
  );
};

    export default App;
