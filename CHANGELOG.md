# Changelog

## [2.7.0] — Policy BYOK backend

### Added

- Enum BYOK, décision pure d'origines ordonnées, exécuteur injectable et ledger par tentative.

### Security

- Tombstone de révocation sans ciphertext et suppression des policy/origin/credentials issus du renderer.

## [2.6.1] — Durcissement Neven

### Security

- Allowlist appliquée au control plane et à chaque passerelle Neven reçue dans un grant.
- Configuration Neven distante non migrée désactivée sans bloquer le démarrage.

### Changed

- Cycle d’annulation et télémétrie non bloquante communs aux flux chat, inline et ghost.

## [2.6.0] — Contrat d’usage Neven v1

### Added

- Publication non bloquante de métriques bornées depuis les completions main process vers Neven.
- `eventId` et clé d’idempotence pour éviter les doublons.
- Refus des URLs HTTP distantes pour les échanges internes et métadonnées de version synchronisées.

## [2.5.0] - Contrat backend multi-provider

### Added

- Contrat backend commun pour completion, streaming, erreurs, timeout/retry,
  usage, capacités et santé des adaptateurs Gemini, Claude, Kimi, Ollama et
  DashScope.
- Adaptateur DashScope configuré uniquement côté backend, sans secret embarqué.

### Changed

- Chat, inline et ghost utilisent désormais le contrat; un provider inconnu
  échoue explicitement sans repli implicite vers Gemini.

## [2.3.0] - Neven Core Lite and prompt compaction

### Added

- Core versionne pour les roles internes Sol, Luna et Terra, avec un manifeste de capacites centralise.
- Selection compacte du catalogue agents/skills pour le routeur invisible afin de reduire le contexte inutile.
- Plan interne versionne qui expose l'intention, le role primaire et le profil sans exposer le modele physique.
- Tests unitaires sur le core, le role et la compaction du prompt.

## [2.2.0] - Control plane Neven côté backend

### Added

- Client du control plane Neven réservé au main process, avec grants courts par workspace et profil interne.
- Cache mémoire, révocation et refus des réponses sans expiration ou passerelle valide.
- Préparation de l'interface admin future sans exposer les clés fournisseurs au renderer.

Toutes les évolutions notables de ce projet sont documentées dans ce fichier.

Le format s'inspire de [Keep a Changelog](https://keepachangelog.com/fr/1.0.0/).

## [2.1.0] — Routeur intelligent invisible

### Added

- Profils internes `haiku`, `luna`, `sol` et `opus`, résolus côté backend selon la complexité et le risque.
- L1 déterministe pour les signaux forts, L2 pour les demandes ambiguës et cascade de fallback explicite.
- Parcours chat `Neven · Auto` sans fournisseur, modèle, tier ou source affichés.

## [2.0.0] — Socle Neven BYOK et agents spécialisés

### Added

- Coffre de credentials fournisseurs chiffré via Electron `safeStorage`, avec révocation et métadonnées sans valeur secrète.
- Politique de routage Neven / BYOK / local par workspace et ledger d'usage par origine de facturation.
- Handlers IPC dédiés aux fournisseurs et agents persistants Sol, Luna et Terra.

### Security

- Le mode géré (`credentialMode: managed`) résout les credentials dans le processus principal et ne dépend plus des clés passées par le renderer.
- BYOK reste désactivé par défaut tant que la migration des anciens champs `*ApiKey` de `settings.json` et le parcours UI avancé ne sont pas livrés.

## [1.9.0] — Barre de navigation 3 modes (IDE / Chat / Agents)

Vue générale de l'interface unifiée en trois modes principaux : IDE (éditeur de
code multi-panneaux), Chat (interface IA conversationnelle full-screen), et Agents
(monde RPG immersif AgentVerse). Chaque mode conserve son état (fichiers ouverts,
historique chat) lors du basculement.

### Added

- **AppViewSwitcher** (`client/src/components/AppShell/AppViewSwitcher.js`) :
  boutons de basculement 3 modes (IDE / Chat / Agents) dans la topbar. État
  persisté via `useAppUiState` (localStorage).
- **Chat Layout** (`client/src/components/AppShell/ChatLayout.js`) : full-screen
  conversationnel avec WorkspacePanel (projets) + AIChat, sans explorateur de
  fichiers ni terminal.
- **Agents Layout** (`client/src/components/AppShell/AgentsLayout.js`) :
  AgentVerse plein écran avec sidebar légère (projets uniquement), callback
  `onViewChanges` pour retour automatique vers IDE → AI Changes au clic sur
  "Voir les changements" d'une tâche complétée.
- **StatusBar amélioré** : affichage du mode courant (ide / chat / agents) et du
  panneau actif (centerView) uniquement en mode IDE pour éviter la confusion.

### Changed

- **WorkspaceLayout.js** : suppression de l'onglet 'Agents' du centre (les
  agents ne sont plus accessibles via un onglet centerView, mais via le mode
  Agents plein écran).
- **App.js** : rendu conditionnel en trois branches `viewMode` (ide / chat /
  agents) ; passage de `viewMode` à StatusBar.

### Removed

- Import/utilisation inutile de `LazyAgentVerse` dans WorkspaceLayout (d'où sa
  présence antérieure dans les tabs du centre).
- Icône `IconAgents` de WorkspaceLayout (n'est plus nécessaire).

## [1.8.0] — Routeur Intelligent

Refactor majeur : remplacement de la sélection manuelle de mode d'exécution
(Ask / Plan / Agent / Collective + provider `ollama-multi`) par un routeur
intelligent à deux couches qui choisit automatiquement entre un agent simple
et une équipe multi-agent (Swarm), tout en simplifiant l'UX et la
configuration des settings. Voir `docs/ARCHITECTURE_ROUTEUR_INTELLIGENT.md`
et `docs/IMPLEMENTATION_ROUTEUR_INTELLIGENT.md` pour le détail.

### Added

- **Routeur Intelligent (L1 + L2)** :
  - `client/src/utils/routerDecision.js` — heuristique locale L1
    (`classifyPromptLayer1`) qui détecte les demandes triviales en local sans
    appel réseau, plus les helpers de convergence
    (`mapRouterModeToExecutionMode`, `mapComplexityToDepth`,
    `matchAgentByName`/`matchSkillByName`, `createFallbackRouterDecision`).
  - `electron/services/router.service.js` — classification L2 côté backend
    (`routeToDecision`) : si L1 est indécis, appelle un modèle léger
    (température 0.1) pour trancher entre `single_agent` / `orchestrator` /
    `multi_agent` et résoudre la complexité (`light` vs `premium`) vers un
    modèle physique concret pour le provider actif.
  - `electron/ipc/routerHandlers.js` — nouveau canal IPC `route-request`,
    exposé au renderer via `window.electronAPI.routeRequest(...)`
    (`preload.js`, `client/src/services/electron.bridge.ts`).
- **UX simplifiée Ask / Plan / Agent + Auto-Route** :
  - `client/src/components/AIChat/index.js` — sélecteur d'agent avec l'option
    « Auto (Sélection intelligente) » qui active le routeur ; le choix d'un
    agent précis le désactive.
  - `client/src/components/AppShell/AppTopbar.js` — badge « Auto-Route »
    (⚡ actif / 🧭 manuel) affiché en permanence dans la Topbar.
  - `useAI.js` — nouveau flag `autoRoute` (activé par défaut) : une demande
    triviale est court-circuitée localement (L1), sinon `route-request`
    décide du mode/agent/skills/profondeur/modèle.
- **Nouvel onglet Settings « Routeur Intelligent »**
  (`client/src/components/Settings/index.js`, id d'onglet `router`) :
  - Activation Manuel vs Auto-Routeur.
  - Choix du provider/modèle de classification L2 (`routerClassifierProvider`,
    `routerClassifierModel`) et de sa clé API si besoin.
  - Slider de seuil de complexité L1→L2 (`routerComplexityThreshold`).
- Convergence du routeur avec le mode Collective existant : la complexité
  résolue (`light` → `fast`, `premium` → `deep`) alimente directement la
  profondeur du run multi-agent (`collectiveDepth`), sans dupliquer la
  logique de `dynamicTeamExecution.js`.

### Changed

- `client/src/utils/agentModes.js` : `isLocalOnlyProvider` et
  `resolveProviderForExecutionMode` ne connaissent plus le provider
  `ollama-multi` — en mode `multi-agent`, le provider résolu est toujours
  `multi` (Roster), quel que soit le provider sélectionné.
- `client/src/utils/collectiveMode.js` : simplifié à `applyCollectiveDepth()`
  uniquement (voir Removed ci-dessous).
- Onglet Settings « Multi-IA » repositionné comme « Roster Multi-Agent » :
  s'applique uniquement quand le mode d'exécution est `Agent` (manuel) ou
  quand le routeur (Auto) décide de former une équipe.

### Removed

- **Feature « Ollama Multi » (Architect / Coder / Tester)** dans son
  intégralité :
  - Le canal IPC backend `get-ollama-multi-completion` et son handler dans
    `electron/ipc/aiHandlers.js`.
  - Le flow front-end `runOllamaMultiCompletionFlow` /
    `client/src/utils/ollamaMultiFlow.js` (+ son fichier de test associé).
  - Le câblage associé dans `useAI.js` : `buildOllamaMultiSteps`,
    `onOllamaMultiToken`, ainsi que le passage du prop `streamingAgent` lié à
    ce flow depuis `AIChat/index.js` vers `LoadingAnimations`.
  - Le provider `ollama-multi` retiré des selects de provider dans
    `AppTopbar.js`, `Settings/index.js` et de la table d'icônes de
    `LoadingAnimations/index.js` (`🦙 Ollama Multi`).
- **Concept `localPrivate` / « Mode Privé Local »**, retiré de :
  - `client/src/utils/collectiveMode.js` (suppression de
    `resolveCollectiveProvider(localPrivate)` et de son export).
  - `client/src/hooks/useAI.js` (variable `effLocalPrivate` et sa résolution,
    paramètre `localPrivate` du hook).
  - `client/src/hooks/useRunConfiguration.js` (état `localPrivate` / setter,
    et son retour dans `multiAgentOptions`).
  - `client/src/components/AIChat/index.js` (checkbox « Mode Privé Local »).
  - `client/src/services/electron.bridge.ts` (champ
    `localPrivate?: boolean | null` de `MultiAgentOptions`).
  - La confidentialité est désormais entièrement pilotée par le Roster
    multi-agents : chaque rôle choisit son propre provider (Ollama local ou
    cloud), le routeur ne force plus jamais un provider global.
- **Réglages de modèles Ollama par rôle** `ollamaModelArchitect`,
  `ollamaModelCoder`, `ollamaModelTester` et leurs champs UI associés, retirés
  de `Settings/index.js`, `useAIModelSettings.js`, `useAISettingsSync.js`,
  `useAI.js`, `AppTopbar.js` (labels `Arch`/`Code`/`Test`),
  `UpdateChecker/index.js` et des valeurs par défaut de
  `electron/services/settings.service.js`. Un seul modèle Ollama
  (`ollamaModel`) subsiste désormais.
