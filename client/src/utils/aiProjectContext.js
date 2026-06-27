import { decoratePromptForMode } from './agentModes';

const extractExplicitContextPaths = (trimmedPrompt) => {
  const explicitContextMatch = trimmedPrompt.match(/^\[Contexte forcé:\s*(.+?)\]\n\n/);
  if (!explicitContextMatch) return [];

  return explicitContextMatch[1]
    .split(',')
    .map((rawPath) => String(rawPath || '').trim())
    .filter(Boolean);
};

const readExplicitContextFiles = async ({
  electronAPI,
  currentProjectPath,
  explicitContextPaths
}) => {
  const explicitContextFilesMap = {};
  if (!explicitContextPaths.length) {
    return { explicitContextFilesContent: '', explicitContextFilesMap };
  }

  try {
    const readPromises = explicitContextPaths.map(async (filePath) => {
      const res = await electronAPI.readFile(currentProjectPath, filePath);
      if (res && res.success) {
        const content = String(res.content || '');
        explicitContextFilesMap[filePath] = {
          type: 'file',
          content,
          size: content.length,
          source: 'mention'
        };
        return `\n--- Contenu de ${filePath} ---\n${content}\n--- Fin de ${filePath} ---\n`;
      }
      return '';
    });
    const contents = await Promise.all(readPromises);
    return {
      explicitContextFilesContent: contents.join('\n'),
      explicitContextFilesMap
    };
  } catch (error) {
    console.warn('[IA] Impossible de charger le contexte explicite:', error);
    return { explicitContextFilesContent: '', explicitContextFilesMap };
  }
};

const shouldLoadProjectContext = ({
  trimmedPrompt,
  normalizedContextMode,
  deepContextEnabled
}) => {
  const projectIntentRegex = /\b(projet|project|repo|repository|structure|arborescence|architecture|analyse|audit|overview|contexte|context|scan|lire|lis|read|workflow|workflows|flux|visuel|diagramme|n8n)\b/i;
  const autoContextWanted =
    !!deepContextEnabled ||
    projectIntentRegex.test(trimmedPrompt);

  if (normalizedContextMode === 'none') return false;
  if (normalizedContextMode === 'mentions') return false;
  return autoContextWanted;
};

const buildProjectScanOptions = ({
  effectiveAIProvider,
  deepContextEnabled,
  contextMaxFiles,
  projectScanPreset,
  projectScanIncludeSecrets,
  projectScanLargeFileStrategy
}) => {
  const scanPresets = {
    safe: {
      includeHidden: false,
      includeBuild: false,
      includeNodeModules: false,
      includeGit: false,
      maxFileSize: 50000,
      maxFiles: 8000,
      maxTotalBytes: 25000000,
      maxDepth: 30
    },
    full: {
      includeHidden: true,
      includeBuild: false,
      includeNodeModules: false,
      includeGit: false,
      maxFileSize: 120000,
      maxFiles: 12000,
      maxTotalBytes: 40000000,
      maxDepth: 40
    },
    god: {
      includeHidden: true,
      includeBuild: true,
      includeNodeModules: true,
      includeGit: true,
      maxFileSize: 250000,
      maxFiles: 50000,
      maxTotalBytes: 150000000,
      maxDepth: 60
    }
  };

  const presetKey = deepContextEnabled || effectiveAIProvider === 'multi' || effectiveAIProvider === 'ollama-multi'
    ? projectScanPreset
    : 'safe';
  const baseOptions = scanPresets[presetKey] || scanPresets.safe;
  const isLocalProvider = effectiveAIProvider === 'ollama' || effectiveAIProvider === 'ollama-multi';
  const scanOptions = {
    ...baseOptions,
    includeSecrets: projectScanIncludeSecrets,
    largeFileStrategy: projectScanLargeFileStrategy,
    includeVisualWorkflows: true,
    metadataOnly: isLocalProvider
  };
  const maxFilesLimit = Number(contextMaxFiles);
  if (Number.isFinite(maxFilesLimit) && maxFilesLimit > 0) {
    scanOptions.maxFiles = Math.max(10, Math.min(scanOptions.maxFiles, Math.floor(maxFilesLimit)));
  }

  if (scanOptions.includeSecrets) {
    scanOptions.includeHidden = true;
  }

  return scanOptions;
};

export const prepareAIProjectContext = async ({
  effectivePrompt,
  currentProjectPath,
  activeFile,
  effectiveAIProvider,
  deepContextEnabled,
  contextMode,
  contextMaxFiles,
  projectScanPreset,
  projectScanIncludeSecrets,
  projectScanLargeFileStrategy,
  executionMode,
  runPreset,
  showMessage,
  electronAPI = window.electronAPI
}) => {
  let trimmedPrompt = effectivePrompt.trim();
  const explicitContextPaths = extractExplicitContextPaths(trimmedPrompt);
  const {
    explicitContextFilesContent,
    explicitContextFilesMap
  } = await readExplicitContextFiles({
    electronAPI,
    currentProjectPath,
    explicitContextPaths
  });

  let promptToSend = explicitContextFilesContent
    ? `${trimmedPrompt}\n\nVoici le contenu des fichiers explicitement mentionnés :\n${explicitContextFilesContent}`
    : trimmedPrompt;

  if (electronAPI?.brainGraphSelect) {
    try {
      const brainRes = await electronAPI.brainGraphSelect(currentProjectPath, trimmedPrompt, {
        activeFile,
        maxFiles: deepContextEnabled ? 14 : 8
      });
      if (brainRes?.success && brainRes.selection?.contextText) {
        promptToSend = `${promptToSend}\n\n${brainRes.selection.contextText}`;
      }
    } catch {
      // Brain Graph context is optional.
    }
  }

  promptToSend = decoratePromptForMode(promptToSend, executionMode, runPreset);

  const normalizedContextMode =
    contextMode === 'mentions' || contextMode === 'none' ? contextMode : 'auto';
  const wantsProjectContext = shouldLoadProjectContext({
    trimmedPrompt,
    normalizedContextMode,
    deepContextEnabled
  });

  let allProjectFiles = Object.keys(explicitContextFilesMap).length > 0
    ? {
      success: true,
      files: explicitContextFilesMap,
      stats: { fileCount: Object.keys(explicitContextFilesMap).length, source: 'mentions' }
    }
    : null;

  if (wantsProjectContext) {
    showMessage('Lecture du contexte projet...', 2000);

    const scanOptions = buildProjectScanOptions({
      effectiveAIProvider,
      deepContextEnabled,
      contextMaxFiles,
      projectScanPreset,
      projectScanIncludeSecrets,
      projectScanLargeFileStrategy
    });

    const projectFilesResponse = await electronAPI.getAllProjectFiles(currentProjectPath, scanOptions);
    if (projectFilesResponse.success) {
      if (Object.keys(explicitContextFilesMap).length > 0) {
        projectFilesResponse.files = {
          ...(projectFilesResponse.files || {}),
          ...explicitContextFilesMap
        };
        projectFilesResponse.stats = {
          ...(projectFilesResponse.stats || {}),
          fileCount: Object.keys(projectFilesResponse.files).length
        };
      }
      allProjectFiles = projectFilesResponse;
      const fileCount = Object.keys(projectFilesResponse.files).length;
      const hitLimit = projectFilesResponse?.stats?.hitLimit;
      const truncated = projectFilesResponse?.stats?.truncatedCount;
      const suffix = hitLimit ? ' (limite atteinte)' : '';
      const truncInfo = truncated ? `, ${truncated} tronqués` : '';
      showMessage(`Contexte lu: ${fileCount} fichiers${truncInfo}${suffix}`, 2200);
    } else {
      showMessage(`Erreur lecture projet: ${projectFilesResponse.error}`, 3000);
    }
  } else if (normalizedContextMode === 'none') {
    showMessage('Contexte IA desactive (mode: none).', 2200);
  } else if (normalizedContextMode === 'mentions') {
    if (explicitContextPaths.length > 0) {
      showMessage(`Contexte par mentions: ${explicitContextPaths.length} fichier(s).`, 2200);
    } else {
      showMessage('Mode mentions: ajoutez @fichier pour injecter du contexte.', 2600);
    }
  } else {
    showMessage('Mode rapide: pas de scan projet (active Ctx si besoin).', 2200);
  }

  return {
    trimmedPrompt,
    promptToSend,
    allProjectFiles
  };
};
