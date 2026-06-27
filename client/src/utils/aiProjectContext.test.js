import { prepareAIProjectContext } from './aiProjectContext';

const buildBaseArgs = (overrides = {}) => ({
  effectivePrompt: 'analyse le projet',
  currentProjectPath: 'C:/demo',
  activeFile: 'src/App.js',
  effectiveAIProvider: 'gemini',
  deepContextEnabled: false,
  contextMode: 'auto',
  contextMaxFiles: 25,
  projectScanPreset: 'safe',
  projectScanIncludeSecrets: false,
  projectScanLargeFileStrategy: 'skip',
  executionMode: 'agent',
  runPreset: 'default',
  showMessage: jest.fn(),
  electronAPI: {
    readFile: jest.fn(),
    brainGraphSelect: jest.fn().mockResolvedValue({ success: false }),
    getAllProjectFiles: jest.fn().mockResolvedValue({
      success: true,
      files: {
        'src/App.js': { content: 'export default function App() {}' }
      },
      stats: { fileCount: 1 }
    })
  },
  ...overrides
});

describe('prepareAIProjectContext', () => {
  test('loads forced context files without scanning the full project in mentions mode', async () => {
    const args = buildBaseArgs({
      effectivePrompt: '[Contexte forcé: src/a.js]\n\nExplique ce fichier',
      contextMode: 'mentions',
      electronAPI: {
        readFile: jest.fn().mockResolvedValue({
          success: true,
          content: 'export const value = 1;'
        }),
        brainGraphSelect: jest.fn().mockResolvedValue({
          success: true,
          selection: { contextText: 'Brain Graph context' }
        }),
        getAllProjectFiles: jest.fn()
      }
    });

    const result = await prepareAIProjectContext(args);

    expect(args.electronAPI.readFile).toHaveBeenCalledWith('C:/demo', 'src/a.js');
    expect(args.electronAPI.getAllProjectFiles).not.toHaveBeenCalled();
    expect(result.allProjectFiles).toMatchObject({
      success: true,
      stats: { fileCount: 1, source: 'mentions' }
    });
    expect(result.allProjectFiles.files['src/a.js'].content).toContain('export const value');
    expect(result.promptToSend).toContain('Voici le contenu');
    expect(result.promptToSend).toContain('Brain Graph context');
    expect(result.promptToSend).toContain('MODE SYSTEME: Agent');
  });

  test('scans project files for project-intent prompts and preserves scan limits', async () => {
    const args = buildBaseArgs();

    const result = await prepareAIProjectContext(args);

    expect(args.electronAPI.getAllProjectFiles).toHaveBeenCalledWith(
      'C:/demo',
      expect.objectContaining({
        includeVisualWorkflows: true,
        includeSecrets: false,
        largeFileStrategy: 'skip',
        maxFiles: 25,
        metadataOnly: false
      })
    );
    expect(args.showMessage).toHaveBeenCalledWith('Lecture du contexte projet...', 2000);
    expect(args.showMessage).toHaveBeenCalledWith('Contexte lu: 1 fichiers', 2200);
    expect(result.allProjectFiles.files['src/App.js'].content).toContain('export default');
  });

  test('uses metadata-only scans for local Ollama providers', async () => {
    const args = buildBaseArgs({
      effectiveAIProvider: 'ollama',
      contextMaxFiles: 120
    });

    await prepareAIProjectContext(args);

    expect(args.electronAPI.getAllProjectFiles).toHaveBeenCalledWith(
      'C:/demo',
      expect.objectContaining({
        maxFiles: 120,
        metadataOnly: true
      })
    );
  });
});
