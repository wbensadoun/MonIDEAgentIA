import { runOllamaMultiCompletionFlow } from './ollamaMultiFlow';

describe('runOllamaMultiCompletionFlow', () => {
  test('starts the swarm state, forwards options and cleans up the step listener', async () => {
    let currentState = null;
    const setMultiAIState = jest.fn((nextState) => {
      currentState = typeof nextState === 'function'
        ? nextState(currentState)
        : nextState;
    });
    const removeListener = jest.fn();
    const electronAPI = {
      onOllamaMultiStep: jest.fn((listener) => {
        listener({ label: 'Codeur', status: 'active', text: 'Generation du patch' });
        return removeListener;
      }),
      getOllamaMultiCompletion: jest.fn().mockResolvedValue({
        success: true,
        text: 'Patch pret',
        models: {
          architect: 'arch-model',
          coder: 'coder-model',
          tester: 'test-model'
        }
      })
    };

    const response = await runOllamaMultiCompletionFlow({
      ollamaModel: 'base-model',
      ollamaModelArchitect: 'arch-model',
      ollamaModelCoder: 'coder-model',
      ollamaModelTester: 'test-model',
      currentProjectPath: 'C:/demo',
      activeAgent: { name: 'agent' },
      activeSkill: { name: 'skill' },
      skills: [
        { name: 'visible-skill', scope: 'project' },
        { name: 'hidden-skill', hasSkillMd: false }
      ],
      sharedAgentContextOptions: { localOnly: true },
      aiConversationHistory: [{ role: 'assistant', text: 'Historique' }],
      newMessage: { role: 'user', text: 'Original' },
      promptToSend: 'Prompt enrichi',
      code: 'const code = true;',
      allProjectFiles: { files: {} },
      setMultiAIState,
      electronAPI
    });

    expect(response).toMatchObject({ success: true, text: 'Patch pret' });
    expect(electronAPI.onOllamaMultiStep).toHaveBeenCalledTimes(1);
    expect(removeListener).toHaveBeenCalledTimes(1);
    expect(electronAPI.getOllamaMultiCompletion).toHaveBeenCalledWith(
      [
        { role: 'assistant', text: 'Historique' },
        { role: 'user', text: 'Prompt enrichi' }
      ],
      'const code = true;',
      { files: {} },
      expect.objectContaining({
        model: 'base-model',
        modelArchitect: 'arch-model',
        modelCoder: 'coder-model',
        modelTester: 'test-model',
        projectPath: 'C:/demo',
        localOnly: true,
        skillsContent: [{ name: 'visible-skill', scope: 'project' }]
      })
    );
    expect(currentState).toMatchObject({
      isActive: false,
      mode: 'ollama-multi',
      runLabel: 'Swarm Ollama',
      currentPhase: 'Swarm termine',
      error: null
    });
    expect(currentState.steps.map((step) => step.status)).toEqual([
      'completed',
      'completed',
      'completed'
    ]);
  });
});
