# Audit du routage IA - 2026-05-30

## Résumé exécutif

L'application possède déjà une base riche : plusieurs providers, un mode Multi-IA, un mode Multi-Ollama, une bibliothèque d'agents/skills, des permissions de fichiers, des workflows visuels et un panneau de changements proposés.

Le problème principal n'est pas l'absence de logique IA. C'est que plusieurs chemins d'exécution ne passent pas par le même routeur. Le chat principal respecte globalement le provider sélectionné, mais l'éditeur, certains workflows et certains générateurs continuent d'appeler Gemini directement. Cela casse l'attente "j'ai choisi Ollama donc je reste local".

Les trois constats critiques :

1. Le chat simple Ollama est bien local pour les appels LLM, mais l'éditeur peut encore appeler Gemini via les complétions inline/ghost.
2. Le mode Multi-IA est un vrai orchestrateur multi-provider, mais par défaut il est cloud-heavy et son "selector" configurable n'est pas réellement appelé comme agent LLM.
3. Plusieurs paramètres existent dans l'UI ou les settings mais sont ignorés, partiellement appliqués ou trompeurs : agent actif, skill actif, provider de workflow Claude, modèle réellement exécuté, budget de contexte local, quick modes.

## Architecture actuelle observée

### Frontend principal

- `client/src/hooks/useAI.js` est le routeur réel du chat.
- `client/src/components/AIChat/index.js` gère l'interface de chat et les actions rapides.
- `client/src/components/AppShell/AppTopbar.js` expose le choix de provider/modèle.
- `client/src/components/Settings/index.js` expose les réglages de providers, modèles, roster Multi-IA, permissions et contexte.
- `client/src/hooks/useAISettingsSync.js` synchronise les settings persistés vers `useAI`.
- `client/src/utils/multiAgentConfig.js` définit le roster Multi-IA.
- `client/src/utils/teamSelector.js` choisit localement les agents Multi-IA selon la demande.

### Backend Electron

- `main.js` contient les handlers IPC et les appels providers réels.
- `preload.js` expose les méthodes IPC au frontend.

### Chemins IA annexes

- `client/src/components/CodeEditor/index.js` utilise les complétions inline/ghost.
- `client/src/utils/workflowRuntime.js` route les noeuds IA des workflows.
- `client/src/hooks/useWorkflowRunner.js` exécute ces workflows.
- `client/src/components/VisualWorkflowEditor/index.js` contient le générateur IA de workflow.
- `client/src/hooks/useAIPendingChanges.js` extrait les propositions de fichiers et crée des AgentRun.

## Flux réel d'exécution du chat

### Schéma simplifié

```text
Utilisateur
  |
  v
AIChat
  |
  v
useAI.handleSendMessage()
  |
  +-- provider = "multi"
  |     |
  |     +-- buildTeamPlan() local
  |     +-- runMultiAgentRole() par rôle
  |     +-- main.js: getGeminiCompletion / getClaudeCompletion / getKimiCompletion / getOllamaCompletion
  |
  +-- provider = "ollama-multi"
  |     |
  |     +-- main.js: get-ollama-multi-completion
  |     +-- Ollama local /api/chat
  |
  +-- provider = "kimi"
  |     |
  |     +-- main.js: get-kimi-completion
  |     +-- Together API
  |
  +-- provider = "claude"
  |     |
  |     +-- main.js: get-claude-completion
  |     +-- Anthropic API
  |
  +-- provider = "ollama"
  |     |
  |     +-- main.js: get-ollama-completion
  |     +-- Ollama local /api/chat
  |
  +-- défaut / "gemini"
        |
        +-- main.js: get-gemini-completion
        +-- Google Generative Language API
```

Preuve :

- `client/src/hooks/useAI.js:183` mappe les providers de rôles vers `getGeminiCompletion`, `getClaudeCompletion`, `getKimiCompletion`, `getOllamaCompletion`.
- `client/src/hooks/useAI.js:808` déclenche le mode `multi`.
- `client/src/hooks/useAI.js:1018` déclenche le mode `ollama-multi`.
- `client/src/hooks/useAI.js:982` déclenche Kimi.
- `client/src/hooks/useAI.js:1120` déclenche Claude.
- `client/src/hooks/useAI.js:1148` déclenche Ollama simple.
- `client/src/hooks/useAI.js:1163` déclenche Gemini par défaut.

## Vérification des providers

### Gemini

Appelé par :

- Chat principal quand `aiProvider` vaut `gemini` ou par défaut.
- Multi-IA pour les rôles configurés en Gemini.
- Workflows IA quand le provider vaut `gemini` ou quand un provider inconnu est normalisé vers Gemini.
- Générateur IA du Visual Workflow Editor, qui est hardcodé Gemini.
- Complétions inline/ghost de l'éditeur, hardcodées Gemini.

Preuve :

- `main.js:4501` définit `get-gemini-completion`.
- `main.js:4536` appelle `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`.
- `client/src/components/VisualWorkflowEditor/index.js:975` appelle `api.getGeminiCompletion(...)`.
- `client/src/components/CodeEditor/index.js:71` et `client/src/components/CodeEditor/index.js:287` appellent les complétions exposées par `preload.js`.
- `main.js:4393` et `main.js:4447` implémentent `get-inline-completion` et `get-ghost-completion` avec Gemini.

### Claude

Appelé par :

- Chat principal quand `aiProvider` vaut `claude`.
- Multi-IA pour les rôles configurés en Claude.

Non supporté par :

- Noeuds IA de workflow.
- Générateur IA de workflow.
- Complétions inline/ghost.

Preuve :

- `main.js:4865` définit `get-claude-completion`.
- `main.js:5027` appelle `anthropic.messages.create`.
- `client/src/utils/workflowRuntime.js:4` ne normalise explicitement que `kimi` et `ollama`; le reste devient `gemini`.

### Kimi

Appelé par :

- Chat principal quand `aiProvider` vaut `kimi`.
- Multi-IA pour les rôles configurés en Kimi.
- Noeuds IA de workflow si le provider du noeud vaut `kimi`.

Preuve :

- `main.js:3897` définit `get-kimi-completion`.
- `main.js:4104` cible par défaut `https://api.together.xyz/v1/chat/completions`.
- `client/src/utils/workflowRuntime.js:25` route `kimi` vers `getKimiCompletion`.

### Ollama

Appelé par :

- Chat principal quand `aiProvider` vaut `ollama`.
- Multi-IA pour les rôles configurés en Ollama.
- Noeuds IA de workflow si le provider du noeud vaut `ollama`.
- Multi-Ollama via un handler séparé.

Preuve :

- `main.js:6749` définit l'URL locale par défaut `http://localhost:11434`.
- `main.js:7188` définit `get-ollama-completion`.
- `main.js:7297` appelle `${OLLAMA_BASE_URL}/api/chat`.
- `main.js:7354` définit `get-ollama-multi-completion`.
- `main.js:7485` appelle `${OLLAMA_BASE_URL_MULTI}/api/chat`.

## Ollama : preuve local-only et limites

### Ce qui est local-only

Le chat simple Ollama n'appelle pas Gemini, Claude ou Together pour la génération LLM principale. Il utilise :

- `main.js:6749` : `http://localhost:11434` par défaut.
- `main.js:7188` : handler `get-ollama-completion`.
- `main.js:7297` : POST vers `/api/chat`.

Le mode Multi-Ollama est également local pour les appels LLM :

- `main.js:7354` : handler `get-ollama-multi-completion`.
- `main.js:7485` : POST vers `/api/chat` pour les rôles internes.

### Ce qui casse l'attente "100 % local"

1. Les complétions inline/ghost de l'éditeur sont Gemini, indépendamment du provider sélectionné dans la topbar.
2. Le générateur IA du Visual Workflow Editor appelle Gemini directement.
3. Les commandes terminal générées par Ollama peuvent exécuter des outils réseau si le mode permission le permet et si l'utilisateur approuve.

Preuve :

- `client/src/components/CodeEditor/index.js:71` appelle `getInlineCompletion`.
- `main.js:4393` implémente `get-inline-completion` avec Gemini.
- `client/src/components/CodeEditor/index.js:287` appelle `getGhostCompletion`.
- `main.js:4447` implémente `get-ghost-completion` avec Gemini.
- `client/src/components/VisualWorkflowEditor/index.js:975` appelle `api.getGeminiCompletion(...)`.
- `main.js:3621` vérifie les permissions avant exécution terminal, mais ne force pas un mode sans réseau.

Conclusion : le chat Ollama est local pour son propre appel LLM, mais l'application entière n'est pas local-only tant que ces chemins annexes existent.

## Multi-Ollama

### Fonctionnement réel

Le mode `ollama-multi` appelle un handler unique :

- `client/src/hooks/useAI.js:1018` branche `aiProvider === 'ollama-multi'`.
- `client/src/hooks/useAI.js:1030` passe `modelArchitect`, `modelCoder`, `modelTester`.
- `main.js:7354` reçoit la demande.

Le backend orchestre ensuite :

1. Architecte.
2. Codeur, avec jusqu'à trois passes.
3. Relecteur QA, avec éventuelles corrections.
4. Synthèse finale.

Preuve :

- `main.js:7705` démarre la phase Architecte.
- `main.js:7791` démarre la phase Codeur.
- `main.js:7882` démarre la phase Relecteur QA.
- `main.js:7974` construit le texte final.

### Modèles réellement utilisés

Le mode Multi-Ollama résout les modèles demandés contre les modèles installés :

- `main.js:7443` définit `resolveRoleModel`.
- `main.js:7469` peut remplacer un modèle demandé par un fallback installé.
- `main.js:7994` retourne `models` et `requestedModels`.

Point positif : contrairement à Ollama simple, Multi-Ollama retourne les modèles résolus.

Point à corriger : l'UI doit rendre très visible quand un fallback a été utilisé.

## Multi-IA

### Fonctionnement réel

Le mode `multi` utilise un selector local, puis exécute des rôles par provider :

- `client/src/hooks/useAI.js:808` démarre la branche Multi-IA.
- `client/src/utils/teamSelector.js:208` construit le plan local.
- `client/src/hooks/useAI.js:878` exécute les stages `analysis`, `planning`, `implementation`, `validation`.
- `client/src/hooks/useAI.js:920` ajoute une synthèse finale par le Captain si sélectionné.

Les providers de rôles viennent du roster :

- `client/src/utils/multiAgentConfig.js:24` à `client/src/utils/multiAgentConfig.js:156`.
- `client/src/hooks/useAI.js:620` résout le provider d'un rôle.
- `client/src/hooks/useAI.js:631` résout la méthode IPC.

### Roster par défaut

Le roster par défaut est cloud-heavy :

- Selector : Gemini Pro.
- Captain : Gemini Pro.
- Domain Expert : Gemini Flash.
- UX Researcher : Gemini Flash.
- UI Analyst : Kimi.
- Frontend Engineer : Kimi.
- API/Data Engineer : Kimi.
- Workflow Engineer : Kimi.
- Security Reviewer : Claude.
- QA Engineer : Kimi.
- Git/Release Manager : Kimi.

Preuve :

- `client/src/utils/multiAgentConfig.js:24` à `client/src/utils/multiAgentConfig.js:156`.

### Points ambigus

1. Le selector est configurable dans le roster, mais n'est pas exécuté comme LLM. Le plan est construit localement par `buildTeamPlan`.
2. Le Captain peut être appelé deux fois : une fois pendant le stage `planning`, puis une fois pour la synthèse finale.
3. Multi-IA n'a pas de verrou "local-only". Si l'utilisateur veut un Multi-IA local, il doit configurer tous les rôles en Ollama.

Preuve :

- `client/src/hooks/useAI.js:808` construit le TeamPlan localement.
- `client/src/hooks/useAI.js:878` exécute les stages, dont `planning`.
- `client/src/hooks/useAI.js:920` appelle à nouveau le Captain pour la synthèse finale.

## Roster et agents/skills

### Roster Multi-IA

Le roster Multi-IA est réel et utilisé pour les rôles multi-agent.

Preuve :

- `client/src/components/Settings/index.js:436` expose l'édition provider/modèle par rôle.
- `client/src/hooks/useAISettingsSync.js:5` synchronise `multiAgentRoles`.
- `client/src/hooks/useAI.js:620` utilise `roleConfig.provider`.
- `client/src/hooks/useAI.js:632` utilise `roleConfig.model`.

### Agents/skills de bibliothèque

Le backend supporte bien les agents et skills :

- `main.js:5631` charge un agent sélectionné.
- `main.js:5664` charge un skill sélectionné.
- `main.js:5696` peut charger tous les global skills.

Mais l'UI de chat ne rend pas réellement sélectionnables `activeAgent` et `activeSkill`.

Preuve :

- `App.js` passe des props d'agents/skills vers `AIChat`.
- `client/src/components/AIChat/index.js` ne destructure pas `agents`, `skills`, `activeAgent`, `activeSkill`, `onActiveAgentChange`, `onActiveSkillChange`.
- `client/src/hooks/useAI.js:199` accepte pourtant `activeAgent` et `activeSkill`.

Conclusion : la fonctionnalité backend existe, mais le chemin utilisateur est incomplet.

## Modes rapides

Les actions rapides `Expliquer`, `Refactor`, `Tests`, `Docs`, `Plan` ne sont pas des modes d'exécution. Elles injectent seulement du texte dans le prompt.

Preuve :

- `client/src/components/AIChat/index.js:760` définit les quick actions.
- `client/src/components/AIChat/index.js:788` ajoute le prompt dans l'input.

Conséquences :

- `Plan` ne force pas un mode lecture seule.
- `Tests` ne garantit pas la création de tests.
- `Docs` ne garantit pas une sortie documentaire.
- `Refactor` ne change ni les permissions ni le moteur.
- Ces boutons sont utiles comme raccourcis de prompt, pas comme modes système.

## Permissions, modifications et conflits

### Points solides

Les modifications proposées par l'IA passent par un mécanisme de propositions :

- `client/src/hooks/useAIPendingChanges.js:676` extrait les blocs `**FICHIER:**`.
- `client/src/hooks/useAIPendingChanges.js:704` enregistre les propositions.
- `client/src/hooks/useAIPendingChanges.js:349` bloque l'application d'un changement si `permissionMode === 'read_only'`.
- `main.js:1464` définit `canEditFiles`.
- `main.js:1480` bloque les writes backend sans permission.
- `main.js:5295` applique un changement AgentRun avec vérification de hash de base.

### Limites

- Le mode `Plan` n'est pas équivalent à `read_only`.
- Certains chemins affichent plutôt une erreur backend qu'un blocage UX explicite.
- Les commandes terminal restent possibles en mode `edit_terminal` après approbation.

## Paramètres ignorés ou trompeurs

| Paramètre / UI | Statut réel | Preuve |
| --- | --- | --- |
| Provider sélectionné dans topbar | Respecté par le chat principal, ignoré par inline/ghost et générateur workflow | `CodeEditor/index.js:71`, `VisualWorkflowEditor/index.js:975` |
| `selector.provider` / `selector.model` | Affiché/configurable mais selector local, pas LLM | `useAI.js:808`, `teamSelector.js:208` |
| `activeAgent` / `activeSkill` | Supportés par backend/hook, pas exposés réellement dans `AIChat` | `useAI.js:199`, `main.js:5631`, `AIChat/index.js` props ignorées |
| `localAIContextBudget` | Calculé dans le budget, mais n'ajuste pas le scan contexte réel | `teamSelector.js:137`, `useAI.js:551` |
| Provider Claude dans workflows | Non supporté, retombe vers Gemini | `workflowRuntime.js:4` |
| Modèle réel Ollama simple | Peut fallback, mais réponse ne retourne pas le modèle résolu | `main.js:7219`, `main.js:7345` |
| Métadonnée modèle dans AgentRun | Souvent inexacte car les handlers ne retournent pas `model` | `useAI.js:1181` |
| Quick modes | Prompts seulement, pas modes système | `AIChat/index.js:760`, `AIChat/index.js:788` |

## Bugs critiques

### 1. Sélection Ollama mais appels Gemini cachés

Gravité : critique pour confidentialité et confiance.

Chemins concernés :

- Complétion inline.
- Ghost completion.
- Générateur de workflow IA.

Pourquoi c'est critique : un utilisateur peut croire être en local avec Ollama alors que du code ou du contexte peut partir vers Gemini via une fonctionnalité annexe.

### 2. Workflows IA non alignés sur les providers globaux

Gravité : élevée.

Les workflows supportent `gemini`, `kimi`, `ollama`, mais pas `claude`. Les providers inconnus retombent vers Gemini.

### 3. Modèle exécuté possiblement différent du modèle affiché

Gravité : élevée.

Ollama simple peut choisir un fallback installé si le modèle demandé n'existe pas, mais la réponse ne retourne pas le modèle résolu. Le journal peut donc enregistrer le mauvais modèle.

### 4. Multi-IA "local" non garanti

Gravité : élevée si l'UI laisse entendre que Multi-IA peut être local sans configuration explicite.

Par défaut, Multi-IA utilise Gemini, Claude et Kimi.

### 5. Agent/skill actif inaccessible depuis le chat

Gravité : moyenne.

La fonctionnalité existe côté backend mais n'est pas reliée correctement à l'interface principale.

## Fonctionnalités inutiles ou historiques

Les éléments suivants semblent morts ou hérités :

- `generateChefDeProjetPrompt`.
- `generateFrontendDevPrompt`.
- `generateBackendDevPrompt`.
- `generateArchitectEngineerPrompt`.
- `generateScrumMasterPrompt`.
- `AGENT_MODELS` si aucun import réel ne l'utilise.
- Badges/termes historiques `chef`, `architect`, `coder`, `tester`, `scrum` si l'UI moderne utilise le roster `captain`, `frontend`, `apiData`, etc.

Conflit de migration :

- Côté client, `architect` est mappé vers `captain`.
- Côté main, `architect` est mappé vers `security`.

Preuve :

- `client/src/utils/multiAgentConfig.js:223`.
- `main.js:1279`.

## Simplifications recommandées

### 1. Créer un routeur IA unique côté frontend

Créer un module du type :

```text
client/src/services/aiRouter.js
```

Responsabilité :

- Recevoir `provider`, `model`, `apiKey`, `mode`, `localOnly`.
- Appeler la bonne méthode IPC.
- Refuser explicitement un fallback cloud si `localOnly` est actif.
- Retourner systématiquement `{ provider, requestedModel, resolvedModel, source }`.

Tous les chemins doivent passer par ce routeur :

- Chat principal.
- Inline completion.
- Ghost completion.
- Workflow IA.
- Générateur workflow.
- Multi-IA role runner.

### 2. Séparer provider global et capacités

Définir une matrice explicite :

```text
chat: gemini, claude, kimi, ollama, multi, ollama-multi
inlineCompletion: gemini, kimi, ollama ou disabled
workflowNode: gemini, claude, kimi, ollama
workflowGenerator: gemini, claude, kimi, ollama
multiRole: gemini, claude, kimi, ollama
localOnly: ollama, ollama-multi, multi avec tous rôles ollama
```

### 3. Ajouter un vrai mode local-only

Le mode local-only doit :

- Désactiver ou router vers Ollama les complétions inline/ghost.
- Désactiver ou router vers Ollama le générateur de workflow.
- Refuser tout provider cloud dans Multi-IA.
- Afficher une erreur claire si une fonctionnalité n'a pas de backend local.

### 4. Rendre les quick modes explicites

Transformer les quick actions en objets avec contraintes :

```text
mode = explain | refactor | tests | docs | plan
mayProposeFiles = true/false
preferredOutput = explanation | patch | testPlan | docs
```

Au minimum, renommer l'UI pour dire que ce sont des prompts rapides, pas des modes.

### 5. Clarifier le roster Multi-IA

Actions :

- Masquer ou annoter le provider/modèle du `selector` si le selector reste heuristique.
- Éviter le double appel Captain, ou renommer le second rôle en `final_synthesizer`.
- Ajouter un bouton "Convertir tout le roster en Ollama".
- Afficher un badge "Cloud" / "Local" par rôle et pour le plan global.

### 6. Retourner les métadonnées provider/modèle depuis tous les handlers

Tous les handlers IPC devraient retourner :

```json
{
  "success": true,
  "text": "...",
  "provider": "ollama",
  "requestedModel": "codellama:7b",
  "resolvedModel": "llama3.1:8b",
  "endpointType": "local"
}
```

Cela corrige les AgentRun et l'historique.

## Architecture cible proposée

```text
UI
  |
  +-- Chat
  +-- Editor completions
  +-- Workflow nodes
  +-- Workflow generator
  |
  v
AI Router frontend
  |
  +-- policy: localOnly / allowCloud / permissions
  +-- provider capability check
  +-- model resolution request
  |
  v
IPC provider gateway
  |
  +-- Gemini adapter
  +-- Claude adapter
  +-- Kimi adapter
  +-- Ollama adapter
  |
  v
Normalized AI response
  |
  +-- text
  +-- provider
  +-- requestedModel
  +-- resolvedModel
  +-- endpointType
  +-- terminalActions
  +-- fileProposals
```

### Règle de confiance

Un choix utilisateur doit avoir une signification globale.

Si l'utilisateur sélectionne Ollama ou active local-only :

- Aucun appel Gemini.
- Aucun appel Claude.
- Aucun appel Together/Kimi.
- Aucun fallback cloud silencieux.
- Toute fonctionnalité incompatible doit être désactivée ou demander une confirmation explicite.

## Fichiers à modifier en priorité

1. `client/src/components/CodeEditor/index.js`
   - Router inline/ghost selon provider global ou désactiver en local-only.

2. `main.js`
   - Faire retourner `provider`, `requestedModel`, `resolvedModel`, `endpointType` dans tous les handlers.
   - Ajouter une protection local-only côté backend.

3. `client/src/components/VisualWorkflowEditor/index.js`
   - Remplacer l'appel hardcodé Gemini par le routeur IA.

4. `client/src/utils/workflowRuntime.js`
   - Supporter Claude.
   - Interdire le fallback provider inconnu vers Gemini sans avertissement.
   - Passer les API keys/modèles settings au runtime.

5. `client/src/hooks/useAI.js`
   - Utiliser les métadonnées normalisées.
   - Corriger la métadonnée modèle.
   - Clarifier l'exécution du Captain.
   - Appliquer une policy local-only pour `multi`.

6. `client/src/components/AIChat/index.js`
   - Exposer la sélection agent/skill si cette fonctionnalité doit rester.
   - Renommer ou durcir les quick actions.

7. `client/src/utils/multiAgentConfig.js` et `main.js`
   - Unifier les maps legacy.
   - Clarifier ou supprimer les anciens rôles morts.

8. `client/src/hooks/useAISettingsSync.js` et `client/src/components/Settings/index.js`
   - Ajouter une option local-only explicite.
   - Afficher les implications cloud/local du roster.

## Tests recommandés

### Tests unitaires

- `useAI` route chaque provider vers le bon handler.
- `aiRouter` refuse Gemini/Claude/Kimi en local-only.
- `workflowRuntime` supporte Claude et ne fallback pas silencieusement vers Gemini.
- `teamSelector` garde un roster tout-Ollama quand local-only est actif.
- `quick actions` restent des prompts ou appliquent les contraintes déclarées.

### Tests d'intégration

- Sélection Ollama + ghost completion : aucun appel Gemini.
- Sélection Ollama + générateur workflow : aucun appel Gemini.
- Multi-IA avec un rôle Claude : seul ce rôle appelle Claude.
- Multi-IA local-only avec rôle cloud : erreur explicite.
- Ollama modèle indisponible : fallback visible et `resolvedModel` correct.

### Tests de non-régression confidentialité

Ajouter des mocks IPC qui échouent le test si `getGeminiCompletion`, `getClaudeCompletion` ou `getKimiCompletion` est appelé pendant une session local-only.

## Correctifs appliqués dans ce passage

Ce passage est un audit. Aucun code fonctionnel n'a été modifié. Le livrable ajouté est ce rapport.

## Risques restants

- Les numéros de ligne peuvent bouger après modification du code.
- Les chemins d'exécution déclenchés uniquement par certains états UI doivent être validés par tests Playwright ou tests React.
- Le terme "local-only" doit être défini comme une policy produit, pas seulement comme un choix de provider.

