import { act, renderHook } from '@testing-library/react';
import useAI from './useAI';
import useAIPendingChanges from './useAIPendingChanges';

// La sous-hook useAIPendingChanges est mockée afin de pouvoir espionner
// processAIFileModifications (elle-même très complexe et déjà couverte par
// ses propres besoins de test) et se concentrer ici sur l'orchestration
// faite par useAI.js : détection des blocs de modification + notification
// interactive en mode lecture seule (checklist 3.3.3).
//
// Tout est construit à l'intérieur de la factory (aucune variable externe
// référencée) pour éviter les pièges de hoisting de `jest.mock`. Le spy sur
// processAIFileModifications est exposé via une propriété sur le mock du
// hook lui-même, récupérable après import. La configuration CRA de ce repo
// active `resetMocks: true` (voir react-scripts/createJestConfig.js), donc
// les implémentations (`mockImplementation` / `mockResolvedValue`) doivent
// être ré-appliquées dans un `beforeEach`, pas seulement dans la factory.
jest.mock('./useAIPendingChanges', () => {
  const processAIFileModifications = jest.fn();
  const useAIPendingChangesMock = jest.fn();
  useAIPendingChangesMock.__processAIFileModifications = processAIFileModifications;
  return {
    __esModule: true,
    default: useAIPendingChangesMock
  };
});

const mockUseAIPendingChanges = useAIPendingChanges;
const mockProcessAIFileModifications = useAIPendingChanges.__processAIFileModifications;

// Valeur de retour complète du hook (toutes les clés destructurées par
// useAI.js) : réappliquée dans un `beforeEach` via `mockReturnValue` car
// `resetMocks: true` efface toute implémentation définie dans la factory
// ci-dessus entre chaque test.
const buildPendingChangesMockReturn = () => ({
  previousCode: null,
  setPreviousCode: jest.fn(),
  isDiffMode: false,
  setIsDiffMode: jest.fn(),
  pendingFileChanges: [],
  activePendingChangeId: null,
  pendingSnapshotId: null,
  activeAgentRunId: null,
  agentRunRefreshKey: 0,
  processAIFileModifications: mockProcessAIFileModifications,
  applyPendingChangeByIndex: jest.fn(),
  rejectPendingChangeByIndex: jest.fn(),
  applyAllPendingChanges: jest.fn(),
  rejectAllPendingChanges: jest.fn(),
  updatePendingChangeContent: jest.fn(),
  handleUndo: jest.fn(),
  handleAcceptDiff: jest.fn(),
  selectPendingChangeByIndex: jest.fn(),
  resetPendingChangesState: jest.fn()
});

// Texte de notification exact issu de client/src/hooks/useAI.js (point 3.3.3).
const INTERACTIVE_NOTIFICATION_TEXT =
  "💡 Des modifications ont été proposées ! Passez en mode 'Agent' pour passer en revue le diff et appliquer les changements.";

// Contient un marqueur `FILE:` détecté par la regex de useAI.js
// (/\*\*FICHIER:\s*|FILE:\s*|<<<<\s*SEARCH/gi), sans mots-clés qui
// déclencheraient un scan complet du projet (prepareAIProjectContext).
const AI_RESPONSE_WITH_FILE_MARKER =
  "Voici la proposition :\nFILE: src/App.js\nContenu mis à jour.";

const renderUseAI = (executionMode, showMessage) => renderHook(() => useAI(
  'C:/project', // currentProjectPath
  '', // code
  jest.fn(), // setCode
  'src/App.js', // activeFile
  true, // isElectronApiAvailable
  showMessage,
  jest.fn(), // setActiveFile
  jest.fn().mockResolvedValue(undefined), // loadProjectItems
  'gemini', // aiProvider
  false, // thinkingMode
  false, // deepContextEnabled
  null, // activeAgent
  null, // activeSkill
  [], // skills
  'edit_terminal', // permissionMode
  {}, // qualityGateConfig
  'auto', // contextMode
  120, // contextMaxFiles
  executionMode,
  {}, // multiAgentOptions
  false, // autoRoute
  jest.fn(), // setRouterDecision
  [] // availableAgents
  // Note (checklist 3.3.4) : le hook ne prend plus (et ne doit pas prendre)
  // ollamaModelArchitect / ollamaModelCoder / ollamaModelTester -> aucun
  // mock n'est ajouté pour ces paramètres.
));

describe('useAI - notification interactive sur propositions de fichiers (checklist 3.3.3)', () => {
  beforeEach(() => {
    mockProcessAIFileModifications.mockClear();
    mockProcessAIFileModifications.mockResolvedValue(undefined);
    mockUseAIPendingChanges.mockReturnValue(buildPendingChangesMockReturn());
    window.electronAPI = {
      getGeminiCompletion: jest.fn().mockResolvedValue({
        success: true,
        text: AI_RESPONSE_WITH_FILE_MARKER,
        model: 'gemini-test-model'
      })
    };
  });

  afterEach(() => {
    delete window.electronAPI;
  });

  test.each(['ask', 'plan'])(
    "traite les propositions de fichiers ET affiche la notification interactive (8000ms) en mode '%s'",
    async (executionMode) => {
      const showMessage = jest.fn();
      const { result } = renderUseAI(executionMode, showMessage);

      await act(async () => {
        await result.current.generateAIResponse('Corrige le bug de connexion dans AuthService');
      });

      // 1) processAIFileModifications est toujours appelé avec le texte de
      // réponse et les métadonnées (prompt, provider, model, summary),
      // peu importe le mode.
      expect(mockProcessAIFileModifications).toHaveBeenCalledWith(
        AI_RESPONSE_WITH_FILE_MARKER,
        expect.objectContaining({
          prompt: expect.any(String),
          provider: 'gemini',
          model: 'gemini-test-model',
          summary: 'Reponse IA'
        })
      );

      // 2) Notification interactive car canProcessFilesForMode === false
      // pour 'ask' et 'plan'.
      expect(showMessage).toHaveBeenCalledWith(INTERACTIVE_NOTIFICATION_TEXT, 8000);
    }
  );

  test("traite les propositions de fichiers SANS afficher la notification interactive en mode 'agent'", async () => {
    const showMessage = jest.fn();
    const { result } = renderUseAI('agent', showMessage);

    await act(async () => {
      await result.current.generateAIResponse('Corrige le bug de connexion dans AuthService');
    });

    // processAIFileModifications reste appelé même en mode Agent.
    expect(mockProcessAIFileModifications).toHaveBeenCalledWith(
      AI_RESPONSE_WITH_FILE_MARKER,
      expect.objectContaining({
        prompt: expect.any(String),
        provider: 'gemini',
        model: 'gemini-test-model',
        summary: 'Reponse IA'
      })
    );

    // Pas de notification interactive car canProcessFilesForMode === true
    // en mode Agent : les changements sont directement visibles dans le
    // panneau de diff, pas besoin d'inciter à changer de mode.
    expect(showMessage).not.toHaveBeenCalledWith(INTERACTIVE_NOTIFICATION_TEXT, 8000);
  });
});
