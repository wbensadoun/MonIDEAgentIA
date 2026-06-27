import { getProviderLabel } from './multiAgentConfig';
import {
  appendMultiAIEvent,
  buildDynamicTeamSteps,
  createEmptyMultiAIState,
  markAllMultiStepsCompleted,
  updateMultiStepsFromEvent
} from './multiAIState';
import {
  buildCompactProjectContext,
  runWithConcurrency
} from './aiAgentRuntime';
import { buildTeamPlan, formatTeamPlanForPrompt } from './teamSelector';

export const runDynamicAgentBatch = async ({
  agents,
  phase,
  previousOutputs,
  teamPlan,
  teamPlanText,
  projectContextStr,
  promptToSend,
  code,
  allProjectFiles,
  runMultiAgentRole,
  setMultiAIState,
  setAiConversationHistory,
  generateAgentPrompt
}) => {
  const safeAgents = Array.isArray(agents) ? agents : [];
  const localAgents = safeAgents.filter((agent) => agent.provider === 'ollama');
  const cloudAgents = safeAgents.filter((agent) => agent.provider !== 'ollama');
  const outputs = [];

  const runOneAgent = async (agent) => {
    setMultiAIState((prev) => ({
      ...prev,
      currentPhase: agent.title,
      steps: updateMultiStepsFromEvent(prev.steps, {
        label: agent.title,
        status: 'active',
        detail: `${phase} - ${agent.reason || agent.focus}`,
        models: prev.models
      }),
      events: appendMultiAIEvent(prev.events, {
        label: agent.title,
        status: 'active',
        detail: `${phase} - ${agent.reason || agent.focus}`,
        roleKey: agent.key
      })
    }));

    const promptText = generateAgentPrompt({
      agent,
      teamPlanText,
      userRequest: promptToSend,
      projectContext: projectContextStr,
      currentCode: code,
      previousOutputs,
      phase
    });

    const response = await runMultiAgentRole({
      roleKey: agent.key,
      promptText,
      projectFiles: allProjectFiles,
      thinking: agent.stage === 'planning' || agent.stage === 'validation',
      maxTokens: Math.min(
        Number(teamPlan?.budget?.maxTokens) || 4096,
        agent.canWrite ? 8192 : 4096
      )
    });

    if (!response.success) {
      throw new Error(`${agent.title}: ${response.error}`);
    }

    const output = {
      agent,
      roleKey: agent.key,
      text: response.text,
      provider: response.provider,
      model: response.model
    };

    setAiConversationHistory((prev) => [...prev, {
      role: 'model',
      text: `**[${agent.title}]**\n\n${response.text}`,
      dynamicAgentKey: agent.key,
      dynamicAgentTitle: agent.title,
      agentProvider: getProviderLabel(response.provider),
      agentModel: response.model
    }]);

    setMultiAIState((prev) => ({
      ...prev,
      steps: updateMultiStepsFromEvent(prev.steps, {
        label: agent.title,
        status: 'completed',
        detail: 'Termine',
        models: prev.models
      }),
      events: appendMultiAIEvent(prev.events, {
        label: agent.title,
        status: 'completed',
        detail: 'Sortie produite.',
        roleKey: agent.key
      })
    }));

    return output;
  };

  const [cloudOutputs, localOutputs] = await Promise.all([
    runWithConcurrency(cloudAgents, teamPlan?.budget?.maxConcurrentCloud || 3, runOneAgent),
    runWithConcurrency(localAgents, teamPlan?.budget?.maxConcurrentLocal || 1, runOneAgent)
  ]);
  outputs.push(...cloudOutputs, ...localOutputs);
  return outputs;
};

export const runDynamicMultiAgentFlow = async ({
  promptToSend,
  allProjectFiles,
  normalizedMultiAgentRoles,
  localAISettings,
  multiAgentOptions,
  setMultiAIState,
  setAiConversationHistory,
  showMessage,
  runMultiAgentRole,
  code,
  generateAgentPrompt,
  generateCaptainPrompt,
  canProcessFilesForMode,
  processAIFileModifications,
  effectiveAIProvider,
  autoSaveConversation,
  updatedHistory,
  electronAPI = window.electronAPI
}) => {
  const projectContextStr = buildCompactProjectContext(allProjectFiles);
  let hardwareProfile = null;

  if (
    localAISettings?.optimizationMode === 'auto' &&
    localAISettings?.hardwareConsent &&
    electronAPI?.getSystemAIProfile
  ) {
    hardwareProfile = await electronAPI.getSystemAIProfile({ consent: true });
  }

  const teamPlan = buildTeamPlan({
    userRequest: promptToSend,
    projectFiles: allProjectFiles,
    rolesConfig: normalizedMultiAgentRoles,
    localAISettings,
    hardwareProfile,
    preferredFormationKey: multiAgentOptions?.formationKey,
    disabledAgentKeys: multiAgentOptions?.disabledAgentKeys
  });
  const teamPlanText = formatTeamPlanForPrompt(teamPlan);
  const multiAgentModelMap = (teamPlan.selectedAgents || []).reduce((acc, agent) => {
    acc[agent.key] = agent.model;
    return acc;
  }, {});

  setMultiAIState({
    ...createEmptyMultiAIState(),
    isActive: true,
    mode: 'multi',
    runLabel: `Equipe ${teamPlan.formationLabel}`,
    currentPhase: 'Selectionneur',
    architectPlan: teamPlanText,
    approvedPlan: null,
    startedAt: Date.now(),
    models: multiAgentModelMap,
    requestedModels: teamPlan.selectedAgents,
    steps: buildDynamicTeamSteps(teamPlan, { selector: 'completed' }),
    events: appendMultiAIEvent([], {
      label: 'Selectionneur',
      status: 'completed',
      detail: `${teamPlan.formationLabel}: ${teamPlan.budget?.reason || 'budget etabli'}`,
      roleKey: 'selector'
    }),
    error: null
  });

  setAiConversationHistory((prev) => [...prev, {
    role: 'model',
    text: `**[Selectionneur - TeamPlan]**\n\n${teamPlanText}`,
    dynamicAgentKey: 'selector',
    dynamicAgentTitle: 'Selectionneur',
    agentProvider: 'Local',
    agentModel: 'heuristique'
  }]);

  showMessage(`Equipe: ${teamPlan.formationLabel} (${teamPlan.selectedAgents.length} agents)`, 3000);

  const outputs = [];
  const agentsByStage = (stage) => (
    teamPlan.selectedAgents.filter((agent) => agent.stage === stage && agent.key !== 'selector')
  );
  const runAgentBatch = (options) => runDynamicAgentBatch({
    ...options,
    promptToSend,
    code,
    allProjectFiles,
    runMultiAgentRole,
    setMultiAIState,
    setAiConversationHistory,
    generateAgentPrompt
  });

  const analysisOutputs = await runAgentBatch({
    agents: agentsByStage('analysis'),
    phase: 'Analyse parallele',
    previousOutputs: outputs,
    teamPlan,
    teamPlanText,
    projectContextStr
  });
  outputs.push(...analysisOutputs);

  const planningOutputs = await runAgentBatch({
    agents: agentsByStage('planning'),
    phase: 'Plan de jeu',
    previousOutputs: outputs,
    teamPlan,
    teamPlanText,
    projectContextStr
  });
  outputs.push(...planningOutputs);

  const implementationOutputs = await runAgentBatch({
    agents: agentsByStage('implementation'),
    phase: 'Implementation',
    previousOutputs: outputs,
    teamPlan,
    teamPlanText,
    projectContextStr
  });
  outputs.push(...implementationOutputs);

  const validationOutputs = await runAgentBatch({
    agents: agentsByStage('validation'),
    phase: 'Validation',
    previousOutputs: outputs,
    teamPlan,
    teamPlanText,
    projectContextStr
  });
  outputs.push(...validationOutputs);

  const finalPrompt = generateCaptainPrompt({
    teamPlanText,
    userRequest: promptToSend,
    previousOutputs: outputs
  });
  const captainAgent = teamPlan.selectedAgents.find((agent) => agent.key === 'captain');
  const captainResponse = captainAgent
    ? await runMultiAgentRole({
      roleKey: 'captain',
      promptText: finalPrompt,
      projectFiles: allProjectFiles,
      thinking: true,
      maxTokens: Math.min(Number(teamPlan?.budget?.maxTokens) || 4096, 4096)
    })
    : { success: true, text: 'Aucun capitaine selectionne.' };

  if (!captainResponse.success) {
    throw new Error(`Capitaine Projet: ${captainResponse.error}`);
  }

  const artifactsText = outputs
    .filter((output) => output?.agent?.canWrite)
    .map((output) => `\n\n## Artefacts - ${output.agent.title}\n${output.text}`)
    .join('');
  const finalDeliverable = `## TeamPlan\n${teamPlanText}\n\n## Synthese Capitaine\n${captainResponse.text}\n${artifactsText}`;

  setMultiAIState((prev) => ({
    ...prev,
    isActive: false,
    currentPhase: 'Equipe terminee',
    finishedAt: Date.now(),
    steps: markAllMultiStepsCompleted(prev.steps, multiAgentModelMap),
    events: appendMultiAIEvent(prev.events, {
      label: '✅ Equipe multi-agent',
      status: 'completed',
      detail: `${teamPlan.formationLabel} terminee.`
    })
  }));

  setAiConversationHistory((prev) => [...prev, {
    role: 'model',
    text: `**[Capitaine Projet - LIVRABLE FINAL]**\n\n${finalDeliverable}`,
    dynamicAgentKey: 'captain',
    dynamicAgentTitle: 'Capitaine Projet',
    agentProvider: captainResponse.provider ? getProviderLabel(captainResponse.provider) : 'Local',
    agentModel: captainResponse.model || 'synthese'
  }]);

  if (canProcessFilesForMode) {
    await processAIFileModifications(finalDeliverable, {
      prompt: promptToSend,
      provider: effectiveAIProvider,
      model: effectiveAIProvider,
      summary: 'Livrable multi-agent'
    });
  }
  await autoSaveConversation(updatedHistory.concat([{ role: 'model', text: finalDeliverable }]));

  showMessage('Multi-IA dynamique terminee avec succes ! 🎉', 4000);

  return {
    finalDeliverable,
    teamPlan
  };
};
