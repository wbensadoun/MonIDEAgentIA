'use strict';

// ---------------------------------------------------------------------------
// Routeur Intelligent Multi-Agents — resolution de decision (backend).
//
// Ce module NE fait AUCUN appel HTTP direct pour la classification : il reutilise
// runSingleCompletionProvider (ai.service) fourni par l'appelant. Pour la resolution
// de modele Ollama il reutilise les utilitaires exportes par ollama.service. Toute la
// fonction routeToDecision est enveloppee dans un try/catch qui renvoie TOUJOURS une
// decision de repli sure (success:true) — zero regression, jamais de throw au renderer.
// La cle API n'est JAMAIS journalisee ni renvoyee.
// ---------------------------------------------------------------------------

const os = require('os');
const {
  DEFAULT_GEMINI_MODEL,
  DEFAULT_GEMINI_PRO_MODEL,
  DEFAULT_KIMI_MODEL,
  DEFAULT_CLAUDE_MODEL,
  normalizeAIProviderName,
  getDefaultModelForAIProvider
} = require('./settings.service');
const {
  OLLAMA_BASE_URL,
  FALLBACK_OLLAMA_MODEL_CANDIDATES,
  normalizeOllamaModelName,
  fetchOllamaTags,
  extractOllamaModelNames,
  pickInstalledOllamaModel,
  recommendOllamaSize
} = require('./ollama.service');

// Placeholder documente : miroir "light" de Claude pour le routeur intelligent.
// Ajustable en UNE ligne quand Anthropic publiera le nom definitif du modele Haiku.
const DEFAULT_CLAUDE_LIGHT_MODEL = 'claude-haiku-4-6';

// ---------------------------------------------------------------------------
// Resolution du modele par tier ('light' | 'premium')
//
// Table de DONNEES uniquement (aucune logique) : motifs de sous-chaine, par provider
// et par tier, essayes DANS L'ORDRE (patterns[0] contre tous les candidats, puis
// patterns[1], etc.). Ajouter une future famille de modeles = ajouter une ligne ici,
// jamais une branche de code.
// ---------------------------------------------------------------------------

const PROVIDER_TIER_PROFILES = Object.freeze({
  gemini: { light: ['flash-lite', 'flash'], premium: ['ultra', 'pro'] },
  claude: { light: ['haiku'], premium: ['opus', 'sonnet'] },
  kimi: { light: ['k2.5', 'k2'], premium: ['k2.6', 'k2'] }
});

// Petites listes statiques locales (miroir des constantes de settings.service),
// utilisees comme candidats quand aucune liste "live" n'est disponible.
const PROVIDER_TIER_STATIC_CANDIDATES = Object.freeze({
  gemini: [DEFAULT_GEMINI_MODEL, DEFAULT_GEMINI_PRO_MODEL],
  claude: [DEFAULT_CLAUDE_LIGHT_MODEL, DEFAULT_CLAUDE_MODEL],
  kimi: [DEFAULT_KIMI_MODEL]
});

// Choisit le premier candidat contenant un motif, motifs essayes dans l'ordre de
// preference (pattern[0] contre tous les candidats avant de tenter pattern[1]).
const pickCandidateByTierPatterns = (candidates, patterns) => {
  const pool = (Array.isArray(candidates) ? candidates : []).filter(Boolean);
  if (pool.length === 0) return null;
  for (const pattern of (Array.isArray(patterns) ? patterns : [])) {
    const needle = String(pattern || '').toLowerCase();
    if (!needle) continue;
    const hit = pool.find((id) => String(id).toLowerCase().includes(needle));
    if (hit) return hit;
  }
  return null;
};

// Extrait la taille (en milliards de parametres) d'un nom de modele Ollama.
// Ex. "qwen3:8b" -> 8, "llama3.1:70b" -> 70, "gemma3:270m" -> null (pas un tag "*b").
const parseOllamaModelSizeB = (modelName) => {
  const match = /:(\d+(?:\.\d+)?)b\b/i.exec(String(modelName || ''));
  return match ? Number(match[1]) : null;
};

// Resolution Ollama du tier : se base sur les modeles REELLEMENT INSTALLES (fetchOllamaTags
// + extractOllamaModelNames), filtre par tier (light <= 8B, premium >= 14B), puis laisse
// recommendOllamaSize choisir la meilleure taille qui tient sur la machine (VRAM/RAM) et
// pickInstalledOllamaModel arbitrer (modele configure > choix materiel > candidats de repli).
const resolveOllamaModelForTier = async (tier, ctx = {}) => {
  try {
    const hw = ctx?.hardwareProfile && typeof ctx.hardwareProfile === 'object' ? ctx.hardwareProfile : {};
    const totalGb = Number(hw.totalGb) > 0 ? Number(hw.totalGb) : os.totalmem() / 1024 / 1024 / 1024;
    const vramGb = Number(hw.vramGb) > 0 ? Number(hw.vramGb) : 0;
    const requested = ctx?.settings?.ollamaModel;

    const tagsResponse = await fetchOllamaTags(OLLAMA_BASE_URL, 5000);
    const installed = extractOllamaModelNames(tagsResponse?.data);

    if (Array.isArray(installed) && installed.length > 0) {
      const withSize = installed.map((name) => ({ name, sizeB: parseOllamaModelSizeB(name) }));
      const tierPool = tier === 'premium'
        ? withSize.filter((m) => (m.sizeB || 0) >= 14)
        : withSize.filter((m) => m.sizeB != null && m.sizeB <= 8);
      const pool = tierPool.length > 0 ? tierPool : withSize;
      const poolNames = pool.map((m) => m.name);

      // Choix materiel : meilleure taille du pool qui tient sur la machine, re-mappee vers un nom installe.
      let hardwareChoice = null;
      const poolSizes = pool.map((m) => (m.sizeB != null ? `${m.sizeB}b` : null)).filter(Boolean);
      if (poolSizes.length > 0) {
        const bestSize = recommendOllamaSize(poolSizes, { vramGb, totalGb });
        if (bestSize) {
          const bestB = Number(String(bestSize).replace(/b$/i, ''));
          hardwareChoice = (pool.find((m) => m.sizeB === bestB) || {}).name || null;
        }
      }

      // Ordre de preference : modele configure (s'il est dans le tier) > choix materiel > repli > premier.
      const preferred = [hardwareChoice, ...FALLBACK_OLLAMA_MODEL_CANDIDATES].filter(Boolean);
      const picked = pickInstalledOllamaModel(requested, poolNames, preferred);
      if (picked) return { resolved: picked, source: 'live' };
    }
  } catch (error) {
    console.error('[Router] Resolution taille Ollama impossible:', error?.message || 'erreur inconnue');
  }

  // Repli structurellement identique au comportement actuel (modele configure ou defaut canonique).
  const fallback = normalizeOllamaModelName(ctx?.settings?.ollamaModel)
    || FALLBACK_OLLAMA_MODEL_CANDIDATES[0]
    || getDefaultModelForAIProvider('ollama');
  return { resolved: fallback, source: 'static' };
};

// Resout le modele physique a utiliser pour un provider + un tier ('light'/'premium').
// ctx optionnel : { liveModels?: string[], hardwareProfile?: {vramGb,totalGb}, settings? }.
// Retourne { resolved, source: 'live'|'registry'|'static' }. Ne leve jamais.
const resolveModelForTier = async (provider, tier, ctx = {}) => {
  const normalizedProvider = normalizeAIProviderName(provider);
  const normalizedTier = tier === 'premium' ? 'premium' : 'light';

  if (normalizedProvider === 'ollama') {
    return resolveOllamaModelForTier(normalizedTier, ctx);
  }

  const patterns = PROVIDER_TIER_PROFILES[normalizedProvider]?.[normalizedTier] || [];
  const staticCandidates = PROVIDER_TIER_STATIC_CANDIDATES[normalizedProvider]
    || [getDefaultModelForAIProvider(normalizedProvider)];

  // Liste "live" optionnelle (ex. Gemini) si l'appelant en fournit une — sinon statique.
  if (Array.isArray(ctx?.liveModels) && ctx.liveModels.length > 0) {
    const pickedLive = pickCandidateByTierPatterns(ctx.liveModels, patterns);
    if (pickedLive) return { resolved: pickedLive, source: 'live' };
  }

  const pickedStatic = pickCandidateByTierPatterns(staticCandidates, patterns);
  if (pickedStatic) return { resolved: pickedStatic, source: 'static' };

  return { resolved: getDefaultModelForAIProvider(normalizedProvider), source: 'static' };
};

// ---------------------------------------------------------------------------
// Classification : prompt, parsing defensif, validation stricte
// ---------------------------------------------------------------------------

// Decision de repli SURE : strictement identique au comportement actuel par defaut
// (agent unique, sans routage) — aucune regression possible en cas d'echec.
const ROUTER_SAFE_FALLBACK_DECISION = Object.freeze({ mode: 'single_agent', agent: null, skills: [], complexity: 'light' });
const ROUTER_VALID_MODES = new Set(['single_agent', 'orchestrator', 'multi_agent']);
const ROUTER_VALID_COMPLEXITY = new Set(['light', 'premium']);
const ROUTER_MAX_AGENTS_IN_PROMPT = 130;
const ROUTER_MAX_SKILLS_IN_PROMPT = 130;
const ROUTER_AGENT_DESC_MAX = 60;
const ROUTER_USER_PROMPT_MAX = 4000;
const ROUTER_CLASSIFICATION_MAX_TOKENS = 512;

const truncateText = (text, max, suffix = '…') => {
  const raw = String(text || '');
  if (!max || raw.length <= max) return raw;
  return raw.slice(0, max) + suffix;
};

// Prompt systeme de classification (FR). La demande utilisateur est passee dans le
// tour utilisateur (voir routeToDecision), pas ici. Ce prompt n'injecte que le contexte
// (agents + skills reels) et le schema JSON strict.
const buildRouterSystemPrompt = (agents, skills) => {
  const agentLines = agents
    .slice(0, ROUTER_MAX_AGENTS_IN_PROMPT)
    .map((a) => {
      const name = String(a?.name || '').trim();
      if (!name) return '';
      const desc = truncateText(String(a?.description || '').replace(/\s+/g, ' ').trim(), ROUTER_AGENT_DESC_MAX);
      return desc ? `- ${name} — ${desc}` : `- ${name}`;
    })
    .filter(Boolean);
  const agentsBlock = agentLines.length > 0
    ? `AGENTS DISPONIBLES :\n${agentLines.join('\n')}`
    : 'AGENTS DISPONIBLES : (aucun)';

  const skillNames = skills
    .map((s) => String(s?.name || '').trim())
    .filter(Boolean)
    .slice(0, ROUTER_MAX_SKILLS_IN_PROMPT);
  const skillsBlock = skillNames.length > 0
    ? `SKILLS DISPONIBLES :\n${skillNames.join(', ')}`
    : 'SKILLS DISPONIBLES : (aucun)';

  return `Tu es le routeur de classification de FuturIA, un assistant de developpement multi-agents. Analyse la demande de l'utilisateur (fournie dans le message utilisateur) et decide UNIQUEMENT comment la router — tu n'executes JAMAIS la tache toi-meme.

${agentsBlock}

${skillsBlock}

RÈGLES ABSOLUES :
1. Réponds UNIQUEMENT avec un objet JSON strict, sans aucun texte avant ou après, sans bloc markdown (pas de \`\`\`).
2. Le JSON doit correspondre EXACTEMENT à ce schéma :
{"mode":"single_agent"|"orchestrator"|"multi_agent","agent":"<nom exact d'un agent ci-dessus ou null>","skills":["<noms exacts de skills ci-dessus>"],"complexity":"light"|"premium"}
3. "mode" : "single_agent" pour une tâche simple confiée à un seul agent (ou aucun agent particulier) ; "orchestrator" si une tâche complexe nécessite une coordination multi-étapes par un chef d'orchestre ; "multi_agent" si plusieurs agents spécialisés doivent collaborer.
4. "agent" doit être le nom EXACT d'un agent listé ci-dessus, ou null si aucun agent spécifique n'est pertinent.
5. "skills" est un tableau des noms EXACTS de skills listés ci-dessus pertinents pour la tâche (tableau vide si aucun).
6. "complexity" = "light" pour une tâche simple/rapide, "premium" pour une tâche complexe qui bénéficierait d'un modèle plus puissant.
7. Si aucun agent ou skill listé n'est pertinent, utilise agent: null et skills: [].`;
};

// Parsing defensif : retire les fences markdown eventuelles puis extrait le premier
// bloc {...} avant JSON.parse. Retourne null (jamais une exception) en cas d'echec.
const parseRouterClassificationResponse = (text) => {
  if (!text) return null;
  let cleaned = String(text).trim();
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace === -1 || lastBrace < firstBrace) return null;
  try {
    const parsed = JSON.parse(cleaned.slice(firstBrace, lastBrace + 1));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
};

// Validation STRICTE contre les vrais noms sur disque : mode/complexity inconnus ->
// valeur par defaut sure ; agent absent du Set -> null ; skills absents du Set -> filtres.
const validateRouterDecision = (raw, agentNameSet, skillNameSet) => {
  const mode = ROUTER_VALID_MODES.has(raw?.mode) ? raw.mode : 'single_agent';

  const agentCandidate = raw?.agent != null ? String(raw.agent).trim() : '';
  const agent = agentCandidate && agentNameSet.has(agentCandidate) ? agentCandidate : null;

  const skillsRaw = Array.isArray(raw?.skills) ? raw.skills : [];
  const skills = skillsRaw
    .map((s) => String(s || '').trim())
    .filter((s) => s && skillNameSet.has(s));

  const complexity = ROUTER_VALID_COMPLEXITY.has(raw?.complexity) ? raw.complexity : 'light';

  return { mode, agent, skills, complexity };
};

// CONVERGENCE des concepts d'execution a partir de la decision :
//  - executionMode : single_agent -> 'agent' ; orchestrator/multi_agent -> 'multi-agent'
//  - depth         : complexity 'light' -> 'fast' ; 'premium' -> 'deep'
//  - localPrivate  : provider ollama -> true (suggestion) ; sinon null (laisse le reglage UI gagner)
const buildExecution = (decision, provider) => ({
  executionMode: decision.mode === 'single_agent' ? 'agent' : 'multi-agent',
  depth: decision.complexity === 'light' ? 'fast' : 'deep',
  localPrivate: provider === 'ollama' ? true : null
});

// ---------------------------------------------------------------------------
// Point d'entree : routeToDecision
// ---------------------------------------------------------------------------

const routeToDecision = async ({
  projectPath,
  userPrompt,
  provider,
  apiKey,
  hardwareProfile,
  settings,
  listAgents,
  listSkills,
  runSingleCompletionProvider
} = {}) => {
  const startedAt = Date.now();
  const normalizedProvider = normalizeAIProviderName(provider);
  const ctx = {
    hardwareProfile: hardwareProfile && typeof hardwareProfile === 'object' ? hardwareProfile : {},
    settings: settings && typeof settings === 'object' ? settings : {}
  };

  try {
    // 1) Liste agents + skills (dedupe par vrai nom, construction des Sets de validation).
    const agentsResult = typeof listAgents === 'function' ? await listAgents(projectPath) : null;
    const skillsResult = typeof listSkills === 'function' ? await listSkills(projectPath) : null;
    const rawAgents = Array.isArray(agentsResult?.agents) ? agentsResult.agents : [];
    const rawSkills = Array.isArray(skillsResult?.skills) ? skillsResult.skills : [];

    const agentByName = new Map();
    for (const a of rawAgents) {
      const name = String(a?.name || '').trim();
      if (name && !agentByName.has(name)) agentByName.set(name, { ...a, name });
    }
    const skillByName = new Map();
    for (const s of rawSkills) {
      const name = String(s?.name || '').trim();
      if (name && !skillByName.has(name)) skillByName.set(name, { ...s, name });
    }
    const agents = Array.from(agentByName.values());
    const skills = Array.from(skillByName.values());
    const agentNameSet = new Set(agentByName.keys());
    const skillNameSet = new Set(skillByName.keys());

    // 2) Rien sur disque -> rien a router : repli direct, sans appel LLM inutile.
    if (agentNameSet.size === 0 && skillNameSet.size === 0) {
      const fallbackModel = await resolveModelForTier(normalizedProvider, 'light', ctx);
      const decision = { ...ROUTER_SAFE_FALLBACK_DECISION };
      return {
        success: true,
        decision,
        execution: buildExecution(decision, normalizedProvider),
        model: { provider: normalizedProvider, tier: 'light', resolved: fallbackModel.resolved, source: fallbackModel.source },
        source: 'fallback',
        timingMs: Date.now() - startedAt
      };
    }

    // 3) Le classifieur (routeur) tourne toujours en tier 'light', quelle que soit la
    //    complexite finale decidee pour la reponse elle-meme. Reutilise runSingleCompletionProvider.
    const routerModel = await resolveModelForTier(normalizedProvider, 'light', ctx);
    const systemInstruction = buildRouterSystemPrompt(agents, skills);
    const completion = await runSingleCompletionProvider({
      provider: normalizedProvider,
      systemInstruction,
      userPrompt: truncateText(String(userPrompt || '').trim(), ROUTER_USER_PROMPT_MAX, '\n[...TRONQUE...]'),
      options: { apiKey, model: routerModel.resolved, temperature: 0.1 },
      maxTokens: ROUTER_CLASSIFICATION_MAX_TOKENS
    });

    let decision = { ...ROUTER_SAFE_FALLBACK_DECISION };
    let source = 'fallback';
    if (completion && completion.success) {
      const parsed = parseRouterClassificationResponse(completion.text);
      if (parsed) {
        decision = validateRouterDecision(parsed, agentNameSet, skillNameSet);
        source = 'llm';
      }
    }

    // 4) Resout le modele FINAL pour la complexite decidee.
    const finalModel = await resolveModelForTier(normalizedProvider, decision.complexity, ctx);

    return {
      success: true,
      decision,
      execution: buildExecution(decision, normalizedProvider),
      model: {
        provider: normalizedProvider,
        tier: decision.complexity,
        resolved: finalModel.resolved,
        source: finalModel.source
      },
      source,
      timingMs: Date.now() - startedAt
    };
  } catch (error) {
    // Jamais de payload (donc jamais de cle API) dans les logs — message generique seulement.
    console.error('[Router] routeToDecision en echec, repli sur le comportement par defaut:', error?.message || 'erreur inconnue');
    const decision = { ...ROUTER_SAFE_FALLBACK_DECISION };
    return {
      success: true,
      decision,
      execution: buildExecution(decision, normalizedProvider),
      model: {
        provider: normalizedProvider,
        tier: 'light',
        resolved: getDefaultModelForAIProvider(normalizedProvider),
        source: 'static'
      },
      source: 'fallback',
      timingMs: Date.now() - startedAt
    };
  }
};

module.exports = {
  routeToDecision,
  resolveModelForTier,
  buildRouterSystemPrompt,
  parseRouterClassificationResponse,
  validateRouterDecision,
  PROVIDER_TIER_PROFILES,
  DEFAULT_CLAUDE_LIGHT_MODEL
};
