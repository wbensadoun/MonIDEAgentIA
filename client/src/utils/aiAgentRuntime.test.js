import {
  buildCompactProjectContext,
  buildSharedAgentContextOptions,
  buildSkillsMetadata,
  runMultiAgentRole,
  runWithConcurrency
} from './aiAgentRuntime';

describe('aiAgentRuntime', () => {
  test('builds bounded shared context options for normal and deep runs', () => {
    expect(buildSharedAgentContextOptions({
      localOnlyRun: true,
      executionMode: 'agent',
      deepContextEnabled: false
    })).toMatchObject({
      localOnly: true,
      includeVisualWorkflows: true,
      includeTemplateCatalog: true,
      maxVisualWorkflowIndexItems: 20,
      maxTemplateCatalogItems: 80
    });

    expect(buildSharedAgentContextOptions({
      localOnlyRun: false,
      executionMode: 'multi-agent',
      deepContextEnabled: true
    })).toMatchObject({
      localOnly: false,
      maxVisualWorkflowIndexItems: 40,
      maxTemplateCatalogItems: 200
    });
  });

  test('normalizes skills metadata without exposing provider credentials', () => {
    expect(buildSkillsMetadata([
      { name: 'project-skill', scope: 'project', hasSkillMd: true },
      { name: 'hidden-skill', scope: 'global', hasSkillMd: false },
      { name: 'legacy-skill' }
    ])).toEqual([
      { name: 'project-skill', scope: 'project' },
      { name: 'legacy-skill', scope: undefined }
    ]);

  });

  test('runs workers with stable result order and builds compact project context', async () => {
    await expect(runWithConcurrency([1, 2, 3], 2, async (item) => item * 2))
      .resolves.toEqual([2, 4, 6]);

    expect(buildCompactProjectContext({
      files: {
        'src/a.js': { content: 'line one\nline two' }
      }
    })).toContain('src/a.js: line one line two');
  });

  test('dispatches a multi-agent role through its configured provider', async () => {
    const electronAPI = {
      getGeminiCompletion: jest.fn().mockResolvedValue({ success: true, text: 'ok' })
    };

    const response = await runMultiAgentRole({
      roleKey: 'frontend',
      promptText: 'Implemente la vue',
      codeContext: 'const code = true;',
      projectFiles: { files: {} },
      normalizedMultiAgentRoles: {
        frontend: { provider: 'gemini', model: 'gemini-test' }
      },
      currentProjectPath: 'C:/demo',
      activeAgent: { name: 'agent' },
      activeSkill: { name: 'skill' },
      skills: [
        { name: 'visible-skill', scope: 'project' },
        { name: 'hidden-skill', hasSkillMd: false }
      ],
      ollamaModel: 'qwen3:8b',
      deepContextEnabled: false,
      sharedAgentContextOptions: { localOnly: false },
      electronAPI
    });

    expect(electronAPI.getGeminiCompletion).toHaveBeenCalledWith(
      [{ role: 'user', text: 'Implemente la vue' }],
      'const code = true;',
      { files: {} },
      expect.objectContaining({
        model: 'gemini-test',
        projectPath: 'C:/demo',
        skillsContent: [{ name: 'visible-skill', scope: 'project' }],
        localOnly: false
      })
    );
    expect(response).toMatchObject({
      success: true,
      provider: 'gemini',
      model: 'gemini-test'
    });
  });
});
