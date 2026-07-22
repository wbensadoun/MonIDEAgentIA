# 📋 Prompt Exhaustif : Refactorisation vers Routeur Intelligent Unifié

## 🎯 Vision Globale
**Remplacer la dualité `ollama-multi` / `multi` par un routeur unique et intelligent qui décide automatiquement du mode d'exécution (1 agent simple vs Swarm multi-agent) en fonction de la complexité de la tâche, tout en simplifiant l'UX à 3 intentions claires (Ask, Plan, Agent) et en nettoyant la configuration des settings.**

---

## 📦 Phase 1 : Suppression & Nettoyage

### 1.1 Suppression complète de la feature `ollama-multi`
- [x] Supprimer les fichiers :
  - `client/src/utils/ollamaMultiFlow.js`
  - `client/src/utils/ollamaMultiFlow.test.js`
  - `electron/services/ai-providers/ollama.provider.js` (ou fusionner avec un provider générique unifié)
  - Tout code IPC backend relatif à `get-ollama-multi-completion`

### 1.2 Suppression de l'option `localPrivate` (Mode de Confidentialité Global)
- [x] Supprimer de `client/src/utils/collectiveMode.js` :
  - La fonction `resolveCollectiveProvider(localPrivate)`
  - Les commentaires et tests mentionnant `localPrivate`
  - L'export `resolveCollectiveProvider`

- [x] Supprimer de `client/src/hooks/useAI.js` :
  - La variable `effLocalPrivate` et sa résolution
  - Le paramètre `localPrivate` du hook `useAI`
  - La logique : `isCollective && effLocalPrivate ? resolveCollectiveProvider(true) : ...`

- [x] Supprimer de `client/src/hooks/useRunConfiguration.js` :
  - L'état `localPrivate` et son setter
  - Le retour dans `multiAgentOptions`

- [x] Supprimer de l'IHM (`client/src/components/AIChat/index.js`) :
  - Le checkbox "Mode Privé Local"

- [x] Supprimer de `client/src/services/electron.bridge.ts` :
  - Le champ `localPrivate?: boolean | null;` de l'interface `MultiAgentOptions`

### 1.3 Suppression de l'option `Multi-Ollama` de la Topbar
- [x] Dans `client/src/components/AppShell/AppTopbar.js` :
  - Retirer `<option value="ollama-multi">Multi-Ollama</option>` du select des providers

- [x] Dans `client/src/components/Settings/index.js` :
  - Retirer `<option value="ollama-multi">Multi-Ollama</option>` du select "Provider IA par défaut"

- [x] Dans `client/src/components/LoadingAnimations/index.js` :
  - Retirer l'entrée `'ollama-multi': { icon: '🦙', label: 'Ollama Multi', color: '#f59e0b' }`

- [x] Dans tous les fichiers mentionnant `ollama-multi` (via grep) :
  - Nettoyer les références résiduelles

### 1.4 Suppression des modèles spécifiques `ollamaModelArchitect`, `ollamaModelCoder`, `ollamaModelTester`
- [x] Dans `client/src/components/Settings/index.js` :
  - Retirer tous les champs de saisie pour `ollamaModelArchitect`, `ollamaModelCoder`, `ollamaModelTester`

- [x] Dans `client/src/hooks/useAIModelSettings.js` :
  - Retirer les états `ollamaModelArchitect`, `ollamaModelCoder`, `ollamaModelTester`
  - Retirer `resolvedOllamaArchitect`, `resolvedOllamaCoder`, `resolvedOllamaTester`
  - Retirer la normalisation et synchronisation de ces champs

- [x] Dans `client/src/hooks/useAISettingsSync.js` :
  - Retirer les champs de synchronisation pour ces modèles d'agent

- [x] Dans `client/src/hooks/useAI.js` :
  - Retirer les paramètres `ollamaModelArchitect`, `ollamaModelCoder`, `ollamaModelTester` du hook
  - Retirer leur passage à `runOllamaMultiCompletionFlow` (qui lui-même sera supprimé)

- [x] Dans `client/src/components/AppShell/AppTopbar.js` :
  - Retirer l'affichage des labels `Arch`, `Code`, `Test` pour Ollama Multi

- [x] Dans `client/src/components/UpdateChecker/index.js` :
  - Retirer les entrées pour ces modèles d'agent

- [x] Dans `electron/services/settings.service.js` :
  - Retirer les valeurs par défaut de ces champs

---

## 🎨 Phase 2 : Simplification de l'UI / UX

### 2.1 Simplifier la Topbar (Passer de 4 modes à 3 intentions claires)

**Avant :**
```
[ Ask ] [ Plan ] [ Agent ] [ Collective ]  +  Provider (gemini/claude/kimi/multi/ollama/ollama-multi)
```

**Après :**
```
[ Ask ] [ Plan ] [ Agent ]  +  Provider (gemini/claude/kimi/ollama)  +  [ 🤖 Auto-Route ]
```

- [x] Dans `client/src/components/AIChat/index.js` :
  - Retirer le mode `multi-agent` du rendu des boutons `EXECUTION_MODES`
  - Le bouton **"Collective"** ne doit plus être exposé manuellement
  - Ajouter un **toggle `Auto-Route`** bien visible (avec icône 🤖 ou ⚡) qui active/désactive le routeur intelligent

  > Note (2026-07-22) : le bouton "Collective" reste accessible manuellement lorsque l'Auto-Route est désactivé (ou via le panneau "Avancé"), plutôt que d'être totalement retiré — décision documentée dans `docs/USER_GUIDE_ROUTER.md` comme 4ᵉ mode manuel. L'objectif "ne doit plus être exposé par défaut / masqué derrière Auto-Route" est atteint ; le retrait total ne l'est pas au sens littéral.

- [x] **Clarifier visuellement** :
  - `Ask` → Icône 💬 (Discussion)
  - `Plan` → Icône 📋 (Planification)
  - `Agent` → Icône 🔧 (Action/Écriture)
  - `Auto-Route` → Icône ⚡ ou 🤖 (Routeur actif)

### 2.2 Revoir le Panel de Settings pour la Configuration du Routeur

**Nouveau Tab "Routeur Intelligent"** dans `client/src/components/Settings/index.js` :

```
┌─────────────────────────────────────────────────┐
│  ⚙️ Routeur Intelligent                          │
├─────────────────────────────────────────────────┤
│                                                 │
│  Comportement par défaut :                      │
│  [ ○ Manuel (utilisateur choisit le mode)      │
│  [ ● Auto-Routeur (routeur décide)             │
│                                                 │
│  Modèle pour la classification (Tier Lite) :   │
│  ┌─────────────────────────────────────┐       │
│  │ Select: gemini / claude / kimi / ... │       │
│  └─────────────────────────────────────┘       │
│                                                 │
│  🔑 Clé API du classifieur (si cloud) :        │
│  ┌─────────────────────────────────────┐       │
│  │ ••••••••••••••••••••••••••••••••••  │       │
│  └─────────────────────────────────────┘       │
│                                                 │
│  Seuil de complexité L1→L2 :                   │
│  ┌────────────────────────────────────┐        │
│  │ Slider: Simple ←──●────→ Complexe  │        │
│  └────────────────────────────────────┘        │
│                                                 │
│  💾 [ Sauvegarder ]                             │
│                                                 │
└─────────────────────────────────────────────────┘
```

- [x] Ajouter un nouveau Tab "Routeur" dans Settings avec 3 sections :
  1. **Activation du routeur** (Radio : Manuel vs Auto)
  2. **Configuration du modèle de classification** (Provider + Clé API optionnelle)
  3. **Seuil de complexité** (Slider pour ajuster le point de basculement L1↔L2)

### 2.3 Revoir le Panel de Settings pour la Configuration Multi-Agent

**Renommer Tab "Multi-IA" → "Roster Multi-Agent"** et clarifier :

```
┌─────────────────────────────────────────────────┐
│  👥 Roster Multi-Agent (Équipe)                 │
├─────────────────────────────────────────────────┤
│                                                 │
│  ✓ Ce roster s'applique UNIQUEMENT quand :    │
│    - Mode d'exécution = "Agent" (Manuel)       │
│    - OU le routeur décide d'un Swarm (Auto)   │
│                                                 │
│  Formation par défaut :                         │
│  ┌─────────────────────────────────────┐       │
│  │ Select: Product/UI | Fullstack | ... │       │
│  └─────────────────────────────────────┘       │
│                                                 │
│  Configuration des rôles :                      │
│  ┌─────────────────────────────────────┐       │
│  │ Sélectionneur     │ Gemini   │ [...]│       │
│  │ Capitaine Projet  │ Gemini   │ [...]│       │
│  │ Expert Métier     │ Gemini   │ [...]│       │
│  │ UX Researcher     │ Gemini   │ [...]│       │
│  │ UI Designer       │ Kimi     │ [...]│       │
│  │ Frontend Engineer │ Kimi     │ [...]│       │
│  │ API/Data Eng      │ Kimi     │ [...]│       │
│  │ ...               │ ...      │ [...]│       │
│  └─────────────────────────────────────┘       │
│                                                 │
│  💾 [ Sauvegarder ]                             │
│                                                 │
└─────────────────────────────────────────────────┘
```

- [x] Clarifier en haut du tab que ce roster s'applique UNIQUEMENT aux exécutions multi-agent (manuelles ou décidées par le routeur)
- [x] Retirer toute mention de "Mode Privé Local" ou "localPrivate"
- [x] Utiliser le langage simple : chaque rôle a un provider (qui peut être local Ollama ou cloud), point.

---

## 🧠 Phase 3 : Logique du Routeur Intelligent

### 3.1 Modifier `client/src/utils/agentModes.js`

**Suppression / Simplification :**

```javascript
// ❌ SUPPRIMER :
export const isLocalOnlyProvider = (provider) => {
  const normalized = String(provider || '').trim().toLowerCase();
  return normalized === 'ollama' || normalized === 'ollama-multi';
};

export const resolveProviderForExecutionMode = (aiProvider, executionMode) => {
  const provider = String(aiProvider || 'gemini').trim().toLowerCase();
  const mode = normalizeExecutionMode(executionMode);
  if (mode !== 'multi-agent') return provider;
  if (provider === 'ollama' || provider === 'ollama-multi') return 'ollama-multi';
  return 'multi';
};

// ✅ REMPLACER PAR :
export const isLocalOnlyProvider = (provider) => {
  const normalized = String(provider || '').trim().toLowerCase();
  return normalized === 'ollama';
};

export const resolveProviderForExecutionMode = (aiProvider, executionMode) => {
  const provider = String(aiProvider || 'gemini').trim().toLowerCase();
  const mode = normalizeExecutionMode(executionMode);
  // En mode multi-agent, on appelle TOUJOURS le routeur unifié 'multi'
  // qui déléguera chaque agent à son provider configuré dans le Roster
  if (mode === 'multi-agent') return 'multi';
  return provider;
};
```

### 3.2 Modifier `client/src/utils/collectiveMode.js`

**Suppression complète de `resolveCollectiveProvider` :**

```javascript
// ❌ SUPPRIMER ENTIÈREMENT :
export const resolveCollectiveProvider = (localPrivate) => (
  localPrivate ? 'ollama-multi' : 'multi'
);

// ✅ Le fichier devient plus simple : applyCollectiveDepth() et c'est tout
```

### 3.3 Modifier `client/src/hooks/useAI.js`

**Point 3.3.1 : Nettoyage de la résolution du provider**

```javascript
// ❌ AVANT (lignes ~269) :
const isCollective = effExecutionMode === 'multi-agent';
const effectiveAIProvider = isCollective && effLocalPrivate
  ? resolveCollectiveProvider(true)
  : resolveProviderForExecutionMode(aiProvider, effExecutionMode);

// ✅ APRÈS :
const isCollective = effExecutionMode === 'multi-agent';
const effectiveAIProvider = resolveProviderForExecutionMode(aiProvider, effExecutionMode);
```

**Point 3.3.2 : Suppression du branchement `ollama-multi`**

```javascript
// ❌ AVANT (lignes ~363-390) :
} else {
  let response;
  if (effectiveAIProvider === 'ollama-multi') {
    response = await runOllamaMultiCompletionFlow({
      ollamaModel,
      ollamaModelArchitect,
      ollamaModelCoder,
      ollamaModelTester,
      ...
    });
  } else {
    // callSingleAIProvider
  }
}

// ✅ APRÈS (fusion simple) :
} else {
  // Mode simple : un seul provider, peu importe lequel
  const modelsForRun = {
    geminiModel,
    claudeModel,
    kimiModel,
    ollamaModel
  };
  if (routerModelOverride) {
    if (effectiveAIProvider === 'gemini') modelsForRun.geminiModel = routerModelOverride;
    else if (effectiveAIProvider === 'claude') modelsForRun.claudeModel = routerModelOverride;
    else if (effectiveAIProvider === 'kimi') modelsForRun.kimiModel = routerModelOverride;
    else if (effectiveAIProvider === 'ollama') modelsForRun.ollamaModel = routerModelOverride;
  }
  
  const response = await callSingleAIProvider({
    effectiveAIProvider,
    updatedHistory,
    aiConversationHistory,
    newMessage,
    promptToSend,
    code,
    allProjectFiles,
    thinkingMode,
    deepContextEnabled,
    currentProjectPath,
    activeAgent: effAgent,
    activeSkill: effSkill,
    sharedAgentContextOptions,
    models: modelsForRun,
    apiKeys: {
      geminiApiKey,
      claudeApiKey,
      kimiApiKey
    }
  });
}
```

**Point 3.3.3 : Notification intelligente en mode Plan/Ask avec propositions**

```javascript
if (response.success) {
  const fullAiText = response.text;
  setAiConversationHistory(prev => [...prev, { role: 'model', text: fullAiText }]);

  // Détection de présence de blocs de modification
  const proposedChangesDetected = /\*\*FICHIER:\s*|FILE:\s*|<<<<\s*SEARCH/gi.test(fullAiText);

  if (proposedChangesDetected) {
    // TOUJOURS parser et afficher les propositions (même en Plan/Ask)
    await processAIFileModifications(fullAiText, {
      prompt: promptToSend,
      provider: effectiveAIProvider,
      model: response.model || geminiModel || kimiModel || claudeModel || ollamaModel,
      summary: 'Reponse IA'
    });

    // ⚠️ Notification interactive si mode lecture seule
    if (!canProcessFilesForMode) {
      showMessage(
        "💡 Des modifications ont été proposées ! Passez en mode 'Agent' pour passer en revue le diff et appliquer les changements.",
        8000
      );
    }
  }

  await autoSaveConversation(updatedHistory.concat([{ role: 'model', text: fullAiText }]));
}
```

**Point 3.3.4 : Supprimer les paramètres obsolètes du hook**

```javascript
// ❌ AVANT :
const useAI = (
  currentProjectPath,
  code,
  setCode,
  ...,
  ollamaModel,
  ollamaModelArchitect,  // ❌ SUPPRIMER
  ollamaModelCoder,      // ❌ SUPPRIMER
  ollamaModelTester,     // ❌ SUPPRIMER
  ...
) => { ... }

// ✅ APRÈS :
const useAI = (
  currentProjectPath,
  code,
  setCode,
  ...,
  ollamaModel,
  ...
) => { ... }
```

### 3.4 Modifier `client/src/hooks/useRunConfiguration.js`

**Suppression de `localPrivate` :**

```javascript
// ❌ AVANT :
const [localPrivate, setLocalPrivate] = useState(false);

return useMemo(() => ({
  disabledAgentKeys,
  multiAgentFormationKey: multiAgentFormationKey,
  collectiveDepth,
  localPrivate  // ❌ SUPPRIMER
}), [...]);

// ✅ APRÈS :
// (pas de localPrivate du tout)

return useMemo(() => ({
  disabledAgentKeys,
  multiAgentFormationKey,
  collectiveDepth
}), [...]);
```

---

## 🔧 Phase 4 : Ajustements Fonctionnels Backend

### 4.1 Retirer le handler IPC `get-ollama-multi-completion`

- [x] Dans `electron/ipc/aiHandlers.js` :
  - Retirer le handler `ipcMain.handle('get-ollama-multi-completion', ...)`

- [x] Dans `preload.js` :
  - Retirer `getOllamaMultiCompletion: (...) => ipcRenderer.invoke(...)`

### 4.2 Retirer le service `electron/services/ai.service.js`

Chercher les fonctions obsolètes :
- `runOllamaMultiCompletionFlow` (si elle existe en Electron)
- Tout handler spécifique à `ollama-multi`

### 4.3 Documenter le Routeur Intelligent dans le Backend

- [x] Dans `electron/services/router.service.js` :
  - Ajouter un commentaire exhaustif expliquant que :
    * **L1 (Trivial)** : Le routeur force `single_agent` + `light` complexity
    * **L2 (Complexe)** : Le routeur propose `multi_agent` + `premium` complexity si nécessaire
    * **Chaque agent du Roster** recevra son propre provider/modèle configuré, jamais une redirection forcée

---

## 📱 Phase 5 : UI Avancée & Messages

### 5.1 Ajouter le Badge "Auto-Route Actif" sur la Topbar

```
┌────────────────────────────────────────┐
│ 💬 Ask | 📋 Plan | 🔧 Agent   ⚡ AUTO │
│ Provider: [Gemini ▼]                   │
│                                        │
│ 🤖 Routeur intelligent détecte le     │
│ mode optimal automatiquement           │
└────────────────────────────────────────┘
```

- [x] Ajouter un badge visuel lumineux ou une icône quand `autoRoute === true`
- [x] Tooltip explicatif : "Le routeur intelligent analyse votre demande et choisit le mode optimal (simple ou équipe multi-agent)"

### 5.2 Notifications Smart dans le Chat

**Cas 1 : Mode Plan + Propositions**
```
💡 Des modifications ont été proposées ! 
Passez en mode 'Agent' pour passer en revue le diff et appliquer les changements.
[ Passer en Agent ]  [ Plus tard ]
```

**Cas 2 : Routeur Active le Mode Multi-Agent (Auto)**
```
🤖 Complexité détectée ! 
Le routeur a activé le mode Équipe Multi-Agent (formation: Product/UI, profondeur: Deep).
[ Voir les détails ]  [ Modifier les paramètres ]
```

**Cas 3 : Routeur Reste en Simple Completion (Auto)**
```
✓ Mode simple suffisant pour cette demande (1 agent spécialisé).
```

### 5.3 Tooltip & Help Text Clarifiés

- [x] Sur le bouton `Auto-Route` :
  ```
  Quand activé: le routeur analyse votre demande et choisit 
  automatiquement entre 1 agent (rapide) ou une équipe (approfondi).
  Quand désactivé: vous contrôlez manuellement le mode et le provider.
  ```

- [x] Dans le Settings, Tab "Routeur Intelligent" :
  ```
  Manuel : Vous choisissez directement le mode (Ask, Plan, Agent) 
  et le provider (Gemini, Ollama, etc.)
  
  Auto-Routeur : L'IDE analyse votre demande en 2 étapes :
    L1 (Local & Rapide) : Analyse heuristique instantanée des mots-clés.
    L2 (Cloud ou Local) : Si L1 hésitant, appelle un modèle léger 
                          pour affiner la décision.
  Le routeur décide ensuite du mode optimal (simple vs Swarm).
  ```

---

## 🧪 Phase 6 : Tests & Validation

### 6.1 Tests à Mettre à Jour / Supprimer

- [x] `client/src/utils/agentModes.test.js` :
  - Supprimer ou adapter les tests mentionnant `ollama-multi`
  - Ajouter des tests pour `resolveProviderForExecutionMode('ollama', 'multi-agent')` → doit retourner `'multi'`

- [x] `client/src/utils/ollamaMultiFlow.test.js` :
  - **SUPPRIMER ENTIÈREMENT** (ce fichier disparaît)

- [x] `client/src/utils/collectiveMode.test.js` :
  - Supprimer le test `test('localPrivate=true → ollama-multi', ...)`
  - Garder les tests pour `applyCollectiveDepth`

- [x] `client/src/hooks/useAI.test.js` (si existe) :
  - Adapter les mocks pour ne pas passer `ollamaModelArchitect`, etc.

### 6.2 Tests de Comportement E2E

- [ ] **Test 1 : Mode Manual (Auto-Route Désactivé)**
  - Utilisateur clique sur `Ask` → Affichage texte seul, pas de propositions appliquées
  - Utilisateur clique sur `Plan` → Affichage textuel + propositions détectées, notification "Passez en Agent"
  - Utilisateur clique sur `Agent` → Propositions appliquées directement
  - **Résultat attendu :** Chaque mode fonctionne comme prévu

- [ ] **Test 2 : Mode Auto-Route (Activé)**
  - Utilisateur tape une demande simple : "Explique cette fonction"
  - **Résultat attendu :** L1 détecte "trivial", force mode `Agent` en background, exécution rapide (1 agent)
  - Utilisateur tape une demande complexe : "Conçois une architecture complète avec frontend, backend, tests et déploiement CI/CD"
  - **Résultat attendu :** L2 appelle le routeur, décide `multi-agent`, lance l'équipe (Swarm)

- [ ] **Test 3 : Provider Local (Ollama) + Roster Cloud (par défaut)**
  - Utilisateur sélectionne `Provider: Ollama` dans la Topbar
  - Routeur décide multi-agent
  - **Résultat attendu :** Seul le provider Ollama est appelé (pas de fuite vers Gemini/Claude)
  - ⚠️ Note : Si l'utilisateur a configuré le Roster avec Gemini, c'est de sa responsabilité

- [ ] **Test 4 : Notification Interactive en Mode Plan**
  - Utilisateur est en mode `Plan`, l'IA propose du code
  - **Résultat attendu :** Code visible dans le chat, onglet `AI Changes` affiche le diff, notification avec bouton "Passer en Agent"

---

## 📊 Phase 7 : Documentation & Communication

### 7.1 Documenter l'Architecture Nouvelle

Créer `docs/ARCHITECTURE_ROUTEUR_INTELLIGENT.md` :

```markdown
# Architecture du Routeur Intelligent

## Vue d'Ensemble
L'application utilise désormais un routeur unique et intelligent qui analyse 
les demandes de l'utilisateur en 2 couches :

### Couche 1 (L1) : Classification Locale Ultra-Rapide
- Analyse heuristique les mots-clés de la demande
- Détecte les tâches triviales en < 100ms
- Décision : mode simple ou indécis

### Couche 2 (L2) : Classification par LLM Lite
- Si L1 hésite, appelle un modèle léger (Gemini Flash, Claude Haiku, etc.)
- Température ultra-basse (0.1) pour des décisions cohérentes
- Résolution du modèle approprié (light vs premium)

## Décisions du Routeur
- **single_agent** + **light** : Une seule IA simple et rapide
- **multi_agent** + **premium** : Une équipe complète pour tâches complexes

## Configuration Utilisateur
Voir Settings → Routeur Intelligent pour :
- Activer/Désactiver le routeur
- Choisir le modèle de classification
- Ajuster le seuil de complexité

## Roster Multi-Agent
Chaque rôle (Frontend, API, QA, etc.) peut être configuré avec son propre 
provider (local Ollama ou cloud). L'utilisateur contrôle entièrement 
la sécurité des données.
```

### 7.2 Guide Utilisateur Simplifié

Créer `docs/USER_GUIDE_ROUTER.md` :

```markdown
# Guide : Mode Auto-Routeur Intelligent

## Les 3 Intentions Principales

### 💬 Ask (Discussion)
- Lisez, explorez, posez des questions
- L'IA ne propose jamais de modifications de fichier
- Idéal pour : comprendre le code, brainstorm, recherche

### 📋 Plan (Planification)
- Concevez une architecture ou un plan d'action
- L'IA propose du contenu (texte, schémas, pseudo-code)
- Si elle génère du code, une notification vous invite à passer en `Agent`
- Idéal pour : designs, stratégies, démonstration

### 🔧 Agent (Action)
- Modifiez votre code directement
- Vous voyez les diffs dans l'onglet "AI Changes"
- Vous approuvez ou rejetez avant application
- Idéal pour : développement actif, refactoring, bug fix

## Auto-Routeur (⚡ Mode Intelligent)

Quand l'Auto-Routeur est **activé** :
- L'IDE analyse votre demande automatiquement
- Pour les tâches **simples** (ex: "Explique cette ligne"), il utilise 1 agent
- Pour les tâches **complexes** (ex: "Conçois une app complète"), il active l'équipe

Avantages :
- ⚡ Réponses instantanées pour les demandes simples
- 🎯 Équipes expertes pour les défis complexes
- 💰 Réduction des coûts token (pas d'overkill pour des tâches triviales)

Quand l'Auto-Routeur est **désactivé** :
- Vous choisissez manuellement le mode (Ask, Plan, Agent)
- Vous restez maître du contrôle total
```

---

## 📋 Phase 8 : Checklist de Déploiement

- [x] **Code Cleanup**
  - [x] Supprimer tous les fichiers obsolètes
  - [x] Exécuter les tests, corriger les erreurs (23/23 suites, 113/113 tests au 2026-07-22)
  - [x] Vérifier les imports orphelins (grep `ollamaMultiFlow`, `resolveCollectiveProvider`, etc.)

- [x] **Configuration**
  - [x] Initialiser les nouvelles clés Settings pour le routeur (`routerAutoRoute`, `routerClassifierProvider`, `routerClassifierModel`, `routerComplexityThreshold` dans `settings.service.js`)
  - [x] Migrer les utilisateurs existants (conserver leur configuration, ajouter les defaults du routeur)

- [ ] **UI/UX Validation**
  - [ ] S'assurer que la Topbar affiche 3 boutons (Ask, Plan, Agent) + Provider + Auto-Route toggle
    > Note (2026-07-22) : la Topbar affiche bien Provider + le badge Auto-Route, mais les boutons Ask/Plan/Agent restent dans le panneau `AIChat` (par choix d'implémentation), pas dans la Topbar elle-même — déviation assumée de la maquette, à visualiser avant validation finale.
  - [x] Vérifier le Settings Tab "Routeur Intelligent"
  - [x] Tester les notifications interactives (couvert par `client/src/hooks/useAI.test.js`)

- [ ] **Tests E2E**
  - [ ] Mode Manual : chaque intention fonctionne
  - [ ] Mode Auto : L1 trivial, L2 complexe
  - [ ] Providers : Ollama seul, Multi-agents avec Roster
    > Aucune infrastructure E2E (Cypress/Playwright) n'existe dans ce dépôt — prérequis non couvert par ce refactor, hors scope automatisé.

- [x] **Documentation**
  - [x] Mettre à jour les README
  - [x] Rédiger les guides pour les utilisateurs et développeurs
  - [x] Faire un changelog clair (`CHANGELOG.md` créé à la racine)

- [ ] **Release**
  - [ ] Tag version (ex: v2.0.0 - Routeur Intelligent)
  - [ ] Annonce à la communauté
  - [ ] Guide de migration pour les utilisateurs
    > Actions humaines/process hors scope d'implémentation automatisée.

---

## 🎯 Résumé des Changements UX/Fonctionnels

| Aspect | Avant | Après |
|--------|-------|-------|
| **Modes d'Exécution** | Ask, Plan, Agent, Collective | Ask, Plan, Agent (+ Auto-Route) |
| **Providers** | gemini, claude, kimi, multi, ollama, ollama-multi | gemini, claude, kimi, ollama (+ routeur) |
| **Config Ollama** | 1 modèle + Architect/Coder/Tester | 1 modèle seulement |
| **Mode Privé Local** | localPrivate toggle | Disparu (Roster gère tout) |
| **Décision Mode** | Utilisateur (manuel) | Utilisateur OU Routeur (auto) |
| **Notifications** | Aucune pour les changements détectés en Plan | Notification interactive si code proposé |
| **Complexité** | 4 modes + 6 paramètres obscurs | 3 intentions claires + 1 routeur intelligent |

---

**Voilà ! C'est le prompt complet et exhaustif pour la refactorisation. Chaque point UI, chaque feature, chaque suppression est documentée. 🚀**
