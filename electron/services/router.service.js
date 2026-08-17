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
//
// ARCHITECTURE DU ROUTEUR INTELLIGENT :
//  - L1 (Trivial) : heuristique locale ultra-rapide (< 100 ms) qui force
//    single_agent + light complexity. Aucun appel reseau.
//  - L2 (Complexe) : si L1 est indécis, appel d'un modèle léger (température 0.1)
//    pour décider entre single_agent/orchestrator/multi_agent et light/premium.
//  - Chaque agent du Roster multi-agents conserve son propre provider/modèle
//    configuré dans les Settings. Le routeur ne force jamais une redirection
//    globale vers un provider unique.
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
  NEVEN_INTERNAL_PROFILES,
  NEVEN_ROUTER_CONTEXT_LIMITS,
  buildNevenRouterContext,
  normalizeProfileName: normalizeNevenProfileName
} = require('./neven-core.service');
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

// Profils internes Neven. Ils décrivent une capacité, pas un fournisseur et ne
// doivent jamais être affichés dans le chat. La résolution physique ci-dessous
// reste entièrement backend : un profil peut changer de modèle sans changer l'UX.
const ROUTER_PROFILE_DEFINITIONS = NEVEN_INTERNAL_PROFILES;
const ROUTER_VALID_PROFILES = new Set(Object.keys(ROUTER_PROFILE_DEFINITIONS));
const PROFILE_MODEL_PATTERNS = Object.freeze({
  haiku: ['haiku', 'flash-lite', 'flash'],
  luna: ['sonnet', 'pro', 'k2'],
  sol: ['sonnet', 'pro', 'k2'],
  opus: ['opus', 'ultra', 'pro', 'sonnet', 'k2']
});

const normalizeRouterProfile = (profile) => {
  const normalized = normalizeNevenProfileName(profile);
  return ROUTER_VALID_PROFILES.has(normalized) ? normalized : 'haiku';
};

const deriveProfileFromDecision = ({ mode, complexity }) => {
  if (mode === 'multi_agent') return 'opus';
  if (mode === 'orchestrator') return 'sol';
  return complexity === 'premium' ? 'luna' : 'haiku';
};

const buildProfileDecision = (profile) => {
  const normalizedProfile = normalizeRouterProfile(profile);
  const definition = ROUTER_PROFILE_DEFINITIONS[normalizedProfile];
  return {
    mode: definition.executionMode === 'agent'
      ? 'single_agent'
      : (normalizedProfile === 'opus' ? 'multi_agent' : 'orchestrator'),
    agent: null,
    skills: [],
    complexity: definition.complexity,
    profile: normalizedProfile
  };
};

// L1 ne tranche que les signaux forts. Les demandes ambiguës passent au L2,
// afin d'éviter qu'une simple heuristique ne choisisse un profil trop faible.
const classifyPromptProfile = (prompt) => {
  const text = String(prompt || '').trim();
  const lower = text.toLowerCase();
  if (!text) return { profile: 'haiku', confidence: 'high', reason: 'empty' };
  if (/^(bonjour|bonsoir|salut|hello|hi|merci|thanks|ok|oui|non|ping)\b/i.test(lower)
    && text.split(/\s+/).length <= 5) {
    return { profile: 'haiku', confidence: 'high', reason: 'small-talk' };
  }
  if (/(production|sécurité|security|vulnér|vulnerab|migration critique|perte de données|data loss|authentification|paiement|compliance|menace|threat)/i.test(text)) {
    return { profile: 'opus', confidence: 'high', reason: 'critical-risk' };
  }
  if (/(architecture|architect|repository|repo|refactor.*(complet|global|entier)|multi[- ]?étapes|multi[- ]?steps|planifie|planifier|débogage.*(complexe|profond)|debug.*(complex|deep)|plusieurs fichiers|multiple files)/i.test(text)) {
    return { profile: 'sol', confidence: 'high', reason: 'multi-step' };
  }
  if (/(bug|erreur|error|fix|corrige|ajoute|add|crée|create|implémente|implement|code|fonction|function|composant|component|test|fichier|file|endpoint|api)/i.test(text)) {
    return { profile: 'luna', confidence: 'medium', reason: 'coding-task' };
  }
  if (text.split(/\s+/).filter(Boolean).length <= 3) {
    return { profile: 'haiku', confidence: 'medium', reason: 'short-request' };
  }
  return null;
};

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

const resolveModelForProfile = async (provider, profile, ctx = {}) => {
  const normalizedProfile = normalizeRouterProfile(profile);
  if (normalizedProfile === 'haiku') return resolveModelForTier(provider, 'light', ctx);

  const normalizedProvider = normalizeAIProviderName(provider);
  if (normalizedProvider === 'ollama') return resolveModelForTier(provider, 'premium', ctx);

  const patterns = PROFILE_MODEL_PATTERNS[normalizedProfile] || PROFILE_MODEL_PATTERNS.luna;
  const candidates = Array.isArray(ctx?.liveModels) && ctx.liveModels.length > 0
    ? ctx.liveModels
    : (PROVIDER_TIER_STATIC_CANDIDATES[normalizedProvider] || [getDefaultModelForAIProvider(normalizedProvider)]);
  const picked = pickCandidateByTierPatterns(candidates, patterns);
  if (picked) return { resolved: picked, source: Array.isArray(ctx?.liveModels) && ctx.liveModels.length > 0 ? 'live' : 'static' };

  return resolveModelForTier(provider, 'premium', ctx);
};

// ---------------------------------------------------------------------------
// Classification : prompt, parsing defensif, validation stricte
// ---------------------------------------------------------------------------

// Decision de repli SURE : strictement identique au comportement actuel par defaut
// (agent unique, sans routage) — aucune regression possible en cas d'echec.
const ROUTER_SAFE_FALLBACK_DECISION = Object.freeze({ mode: 'single_agent', agent: null, skills: [], complexity: 'light', profile: 'haiku' });
const ROUTER_VALID_MODES = new Set(['single_agent', 'orchestrator', 'multi_agent']);
const ROUTER_VALID_COMPLEXITY = new Set(['light', 'premium']);
const ROUTER_MAX_AGENTS_IN_PROMPT = NEVEN_ROUTER_CONTEXT_LIMITS.maxAgents;
const ROUTER_MAX_SKILLS_IN_PROMPT = NEVEN_ROUTER_CONTEXT_LIMITS.maxSkills;
const ROUTER_AGENT_DESC_MAX = 60;
const ROUTER_USER_PROMPT_MAX = 4000;
const ROUTER_CLASSIFICATION_MAX_TOKENS = 512;

const truncateText = (text, max, suffix = '…') => {
  const raw = String(text || '');
  if (!max || raw.length <= max) return raw;
  return raw.slice(0, max) + suffix;
};

// ---------------------------------------------------------------------------
// Settings utilisateur du Routeur Intelligent (onglet Settings > "Routeur
// Intelligent", voir client/src/components/Settings/index.js et les defauts
// dans settings.service.js) :
//  - `routerClassifierProvider` / `routerClassifierModel` choisissent le provider/
//    modele utilise pour l'appel de classification L2, independamment du provider
//    d'execution. `null`/absent -> repli sur le provider d'execution courant +
//    resolveModelForTier('light') (comportement historique inchange).
//  - `routerComplexityThreshold` (nombre flottant [0,1], defaut 0.5 — identique au
//    defaut de settings.service.js) regle la frontiere locale L1->L2 : plus il est
//    bas, plus l'heuristique locale (L1) tranche seule sans appel reseau ; plus il
//    est haut, plus les cas ambigus sont envoyes au classifieur L2 (cf. le hint de
//    l'onglet Settings). Valeur absente/invalide -> repli sur 0.5.
// Toutes ces cles sont OPTIONNELLES et n'importe quelle valeur absente/invalide
// retombe strictement sur le comportement par defaut documente ci-dessus.
// ---------------------------------------------------------------------------

// Repli par defaut du seuil L1->L2, identique au defaut de settings.service.js.
const ROUTER_COMPLEXITY_THRESHOLD_FALLBACK = 0.5;

// Au-dela de ce nombre de mots (sans indice d'action), le score de complexite locale
// atteint son maximum (1) — calibrage volontairement bas pour rester conservateur :
// un prompt de plus de 8 mots n'est jamais considere "surement trivial" par defaut.
const ROUTER_COMPLEXITY_WORD_SCALE = 8;

// Indices qu'une VRAIE demande d'action/code est en jeu : meme tres courte, une telle
// demande ne doit jamais etre traitee comme triviale par l'heuristique locale (miroir
// volontaire du pattern ACTION_HINT de client/src/utils/routerDecision.js#classifyPromptLayer1
// pour rester coherent avec la couche L1 deja existante cote renderer).
const ROUTER_ACTION_HINT_PATTERN = /```|\bcode\b|\bbug\b|\berror\b|\berreur\b|\bfix\b|\brefactor\b|\btest\b|\bimpl[ée]ment|\bcr[ée]e|\bcreate\b|\badd\b|\bajoute|\bg[ée]n[èe]re|\bfunction\b|\bclass\b|\bcomponent\b|\bcompos|\bapi\b|\bfichier\b|\bfile\b/i;

// Nombre de mots du prompt utilisateur (heuristique L1 locale, aucun appel reseau).
const countPromptWords = (text) => String(text || '').trim().split(/\s+/).filter(Boolean).length;

// Score de complexite locale [0 = trivial, 1 = complexe], purement local (<100ms, aucun
// appel reseau). Base sur la longueur du prompt ; plancher a 0.5 des qu'un indice d'action
// (code/bug/fix/...) est detecte, pour ne jamais classer une vraie demande comme triviale.
const estimatePromptComplexity = (prompt) => {
  const text = String(prompt || '').trim();
  if (!text) return 0;
  const lengthScore = Math.min(1, countPromptWords(text) / ROUTER_COMPLEXITY_WORD_SCALE);
  return ROUTER_ACTION_HINT_PATTERN.test(text) ? Math.max(0.5, lengthScore) : lengthScore;
};

// Resout le seuil L1->L2 configure par l'utilisateur (Settings > Routeur Intelligent),
// clampe a [0,1], repli sur ROUTER_COMPLEXITY_THRESHOLD_FALLBACK si absent/invalide.
const resolveComplexityThreshold = (settings) => {
  const raw = Number(settings?.routerComplexityThreshold);
  if (!Number.isFinite(raw)) return ROUTER_COMPLEXITY_THRESHOLD_FALLBACK;
  return Math.min(1, Math.max(0, raw));
};

// Decide si le prompt peut etre tranche localement par L1 (aucun appel reseau) ou doit
// escalader vers L2. Seuil bas -> L1 tranche plus souvent ; seuil haut -> plus de cas
// escaladent vers L2 (cf. hint de l'onglet Settings > Routeur Intelligent).
const isPromptTrivialForL1 = (userPrompt, settings) => {
  const threshold = resolveComplexityThreshold(settings);
  const complexity = estimatePromptComplexity(userPrompt);
  return complexity <= (1 - threshold);
};

// Resout le provider + modele a utiliser pour l'appel de classification L2.
// Repli sur le provider d'execution courant + resolveModelForTier('light') des que
// `routerClassifierProvider`/`routerClassifierModel` sont absents/invalides (comportement
// historique inchange). Ne leve jamais.
const resolveClassifierTarget = async (settings, normalizedProvider, ctx) => {
  const configuredProvider = settings?.routerClassifierProvider
    ? normalizeAIProviderName(settings.routerClassifierProvider)
    : null;
  const classifierProvider = configuredProvider || normalizedProvider;

  const configuredModel = settings?.routerClassifierModel ? String(settings.routerClassifierModel).trim() : '';
  if (configuredModel) {
    return { provider: classifierProvider, resolved: configuredModel, source: 'settings' };
  }

  const resolved = await resolveModelForTier(classifierProvider, 'light', ctx);
  return { provider: classifierProvider, resolved: resolved.resolved, source: resolved.source };
};

// Prompt systeme de classification (FR). La demande utilisateur est passee dans le
// tour utilisateur (voir routeToDecision), pas ici. Ce prompt n'injecte que le contexte
// (agents + skills reels) et le schema JSON strict.
const buildRouterSystemPrompt = (agentsOrContext, maybeSkills = []) => {
  const context = Array.isArray(agentsOrContext)
    ? { agents: agentsOrContext, skills: maybeSkills }
    : (agentsOrContext && typeof agentsOrContext === 'object' ? agentsOrContext : {});
  const routerContext = buildNevenRouterContext({
    prompt: context.userPrompt || '',
    agents: Array.isArray(context.agents) ? context.agents : [],
    skills: Array.isArray(context.skills) ? context.skills : [],
    maxAgents: Number.isFinite(Number(context.maxAgents)) ? Number(context.maxAgents) : ROUTER_MAX_AGENTS_IN_PROMPT,
    maxSkills: Number.isFinite(Number(context.maxSkills)) ? Number(context.maxSkills) : ROUTER_MAX_SKILLS_IN_PROMPT,
    maxCapabilities: Number.isFinite(Number(context.maxCapabilities))
      ? Number(context.maxCapabilities)
      : NEVEN_ROUTER_CONTEXT_LIMITS.maxCapabilities
  });

  return `Tu es le routeur de classification de Code Companion, un assistant de developpement multi-agents. Analyse la demande de l'utilisateur (fournie dans le message utilisateur) et decide UNIQUEMENT comment la router — tu n'executes JAMAIS la tache toi-meme.

${routerContext.agentBlock}

${routerContext.skillBlock}

RÈGLES ABSOLUES :
1. Réponds UNIQUEMENT avec un objet JSON strict, sans aucun texte avant ou après, sans bloc markdown (pas de \`\`\`).
2. Le JSON doit correspondre EXACTEMENT à ce schéma :
{"mode":"single_agent"|"orchestrator"|"multi_agent","agent":"<nom exact d'un agent ci-dessus ou null>","skills":["<noms exacts de skills ci-dessus>"],"complexity":"light"|"premium","profile":"haiku"|"luna"|"sol"|"opus"}
3. "mode" : "single_agent" pour une tâche simple confiée à un seul agent (ou aucun agent particulier) ; "orchestrator" si une tâche complexe nécessite une coordination multi-étapes par un chef d'orchestre ; "multi_agent" si plusieurs agents spécialisés doivent collaborer.
4. "agent" doit être le nom EXACT d'un agent listé ci-dessus, ou null si aucun agent spécifique n'est pertinent.
5. "skills" est un tableau des noms EXACTS de skills listés ci-dessus pertinents pour la tâche (tableau vide si aucun).
6. "complexity" = "light" pour une tâche simple/rapide, "premium" pour une tâche complexe qui bénéficierait d'un modèle plus puissant.
7. "profile" est interne à Neven : haiku pour rapide, luna pour coding courant, sol pour planification/orchestration, opus pour risque critique ou multi-agent réel.
8. Si aucun agent ou skill listé n'est pertinent, utilise agent: null et skills: [].`;
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
  const requestedMode = ROUTER_VALID_MODES.has(raw?.mode) ? raw.mode : 'single_agent';

  const agentCandidate = raw?.agent != null ? String(raw.agent).trim() : '';
  const agent = agentCandidate && agentNameSet.has(agentCandidate) ? agentCandidate : null;

  const skillsRaw = Array.isArray(raw?.skills) ? raw.skills : [];
  const skills = skillsRaw
    .map((s) => String(s || '').trim())
    .filter((s) => s && skillNameSet.has(s));

  const requestedComplexity = ROUTER_VALID_COMPLEXITY.has(raw?.complexity) ? raw.complexity : 'light';
  const profile = ROUTER_VALID_PROFILES.has(String(raw?.profile || '').trim().toLowerCase())
    ? String(raw.profile).trim().toLowerCase()
    : deriveProfileFromDecision({ mode: requestedMode, complexity: requestedComplexity });
  const profileDefinition = ROUTER_PROFILE_DEFINITIONS[profile];

  return {
    mode: profileDefinition.executionMode === 'agent'
      ? 'single_agent'
      : (profile === 'opus' ? 'multi_agent' : 'orchestrator'),
    agent,
    skills,
    complexity: profileDefinition.complexity,
    profile
  };
};

// CONVERGENCE des concepts d'execution a partir de la decision :
//  - executionMode : single_agent -> 'agent' ; orchestrator/multi_agent -> 'multi-agent'
//  - depth         : complexity 'light' -> 'fast' ; 'premium' -> 'deep'
// Le routeur ne renvoie plus de drapeau localPrivate : le Roster multi-agents
// gère lui-même le provider de chaque agent (Ollama local ou cloud).
const buildExecution = (decision) => {
  const profile = normalizeRouterProfile(decision?.profile || deriveProfileFromDecision(decision || {}));
  const definition = ROUTER_PROFILE_DEFINITIONS[profile];
  return {
    executionMode: definition.executionMode,
    depth: definition.depth,
    profile
  };
};

// ---------------------------------------------------------------------------
// Point d'entree : routeToDecision
// ---------------------------------------------------------------------------

const routeToDecision = async ({
  projectPath,
  userPrompt,
  listAgents,
  listSkills,
  runSingleCompletionProvider,
  workspaceContext,
  trustedRouterConfiguration = {}
} = {}) => {
  const startedAt = Date.now();
  // Built by the main process from trusted settings/workspace state. Legacy
  // provider/apiKey/settings inputs are deliberately ignored if callers send them.
  const trustedConfiguration = trustedRouterConfiguration && typeof trustedRouterConfiguration === 'object'
    ? trustedRouterConfiguration
    : {};
  const trustedSettings = trustedConfiguration.settings && typeof trustedConfiguration.settings === 'object'
    ? trustedConfiguration.settings
    : {};
  const normalizedProvider = normalizeAIProviderName(trustedConfiguration.provider || trustedSettings.defaultProvider);
  const ctx = {
    hardwareProfile: trustedConfiguration.hardwareProfile && typeof trustedConfiguration.hardwareProfile === 'object'
      ? trustedConfiguration.hardwareProfile
      : {},
    settings: trustedSettings
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
      const fallbackModel = await resolveModelForProfile(normalizedProvider, 'haiku', ctx);
      const decision = { ...ROUTER_SAFE_FALLBACK_DECISION };
      return {
        success: true,
        decision,
        execution: buildExecution(decision),
        model: { provider: normalizedProvider, profile: 'haiku', resolved: fallbackModel.resolved, source: fallbackModel.source },
        source: 'fallback',
        timingMs: Date.now() - startedAt
      };
    }

    // 2bis) L1 (Trivial) : heuristique locale (longueur + indices d'action), frontiere
    //       configurable via `routerComplexityThreshold` (Settings > Routeur Intelligent,
    //       repli 0.5). Aucun appel reseau ici : si le prompt est juge trivial, repli
    //       direct sur la decision sure, tier 'light'.
    const localProfile = classifyPromptProfile(userPrompt);
    if (localProfile?.confidence === 'high' || isPromptTrivialForL1(userPrompt, ctx.settings)) {
      const profile = localProfile?.profile || 'haiku';
      const fallbackModel = await resolveModelForProfile(normalizedProvider, profile, ctx);
      const decision = buildProfileDecision(profile);
      return {
        success: true,
        decision,
        execution: buildExecution(decision),
        model: { provider: normalizedProvider, profile, resolved: fallbackModel.resolved, source: fallbackModel.source },
        source: 'fallback',
        timingMs: Date.now() - startedAt
      };
    }

    // 3) Le classifieur (routeur) tourne toujours en tier 'light', quelle que soit la
    //    complexite finale decidee pour la reponse elle-meme. Reutilise runSingleCompletionProvider.
    //    Provider/modele du classifieur configurables via Settings > Routeur Intelligent
    //    (routerClassifierProvider/routerClassifierModel) ; repli sur le provider d'execution
    //    courant + resolveModelForTier('light') si non configures (comportement historique).
    //    Credential and policy resolution remains at the trusted main/workspace
    //    execution boundary of runSingleCompletionProvider.
    const classifierTarget = await resolveClassifierTarget(ctx.settings, normalizedProvider, ctx);
    const systemInstruction = buildRouterSystemPrompt({
      agents,
      skills,
      userPrompt,
      maxAgents: ROUTER_MAX_AGENTS_IN_PROMPT,
      maxSkills: ROUTER_MAX_SKILLS_IN_PROMPT
    });
    const completion = await runSingleCompletionProvider({
      provider: classifierTarget.provider,
      systemInstruction,
      userPrompt: truncateText(String(userPrompt || '').trim(), ROUTER_USER_PROMPT_MAX, '\n[...TRONQUE...]'),
      options: { model: classifierTarget.resolved, temperature: 0.1 },
      maxTokens: ROUTER_CLASSIFICATION_MAX_TOKENS,
      workspaceContext
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

    // 4) Résout le modèle FINAL depuis le profil interne, jamais depuis une
    // préférence visible dans le chat.
    const finalProfile = normalizeRouterProfile(decision.profile);
    const finalModel = await resolveModelForProfile(normalizedProvider, finalProfile, ctx);

    return {
      success: true,
      decision,
      execution: buildExecution(decision),
      model: {
        provider: normalizedProvider,
        profile: finalProfile,
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
      execution: buildExecution(decision),
      model: {
        provider: normalizedProvider,
        profile: 'haiku',
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
  resolveModelForProfile,
  resolveComplexityThreshold,
  resolveClassifierTarget,
  estimatePromptComplexity,
  classifyPromptProfile,
  isPromptTrivialForL1,
  buildRouterSystemPrompt,
  parseRouterClassificationResponse,
  validateRouterDecision,
  ROUTER_PROFILE_DEFINITIONS,
  ROUTER_VALID_PROFILES,
  PROVIDER_TIER_PROFILES,
  ROUTER_COMPLEXITY_THRESHOLD_FALLBACK,
  DEFAULT_CLAUDE_LIGHT_MODEL
};
