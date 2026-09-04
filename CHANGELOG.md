# Changelog

## [4.22.0] — Sélection de session accessible

### Fixed

- La sélection des sessions du chat est désormais un bouton indépendant des actions d’ouverture et du menu contextuel.

## [4.21.0] — Lignes UI sémantiques

### Fixed

- Les conversations sauvegardées et les chemins de changements en attente du chat sont désormais des contrôles clavier explicites, sans bouton imbriqué.

## [4.20.0] — Tokens CSS du Brain Graph

### Fixed

- Les nœuds et badges du Brain Graph utilisent désormais les tokens de thème existants, sans couleurs codées en dur qui échappent au contrôle Stylelint.

## [4.19.0] — Tooltip des IconButton

### Added

- Les `IconButton` icon-only réutilisent désormais le Tooltip partagé au focus et au survol, tout en conservant leur `title` natif.

## [4.18.0] — Focus clavier de l’arbre Workspace

### Fixed

- Les lignes projet et conversation de `WorkspacePanel` sont désormais activables au clavier avec Enter/Espace et exposent un focus visible cohérent avec les tokens.

## [4.17.0] — Tooltip partagé pour les contrôles compacts

### Added

- Ajout d’une primitive `Tooltip` themeable qui se révèle au survol et au focus clavier, avec conservation du `title` natif comme fallback.
- Adoption sur les contrôles icon-only de l’Activity Bar.

## [4.16.0] — Primitive Select partagée

### Added

- Ajout d’une primitive `Select` partagée qui conserve le combobox natif et le clavier OS tout en normalisant la flèche et la surface du thème.
- Migration des 9 selects de Settings ; le listbox custom reste explicitement une étape ultérieure.

## [4.15.0] — Stabilité des tests App

### Fixed

- Le test de démarrage accepte les occurrences légitimes multiples de la marque `Code Companion` dans le shell, l’accueil éditeur et l’accueil chat.

## [4.14.0] — Primitive Button partagée

### Added

- Ajout d’une primitive `Button` partagée avec `type="button"` par défaut, état loading accessible et conservation des classes visuelles existantes pendant les migrations.
- Migration des contrôles de l’Explorateur vers cette primitive.

## [4.13.0] — Garde-fous de dette CSS

### Added

- La gate de design debt suit désormais aussi les régressions de `border-radius` hardcodés, de `z-index` numériques et de groupes de fichiers CSS dupliqués, avec des budgets régressifs explicites.

## [4.12.0] — Dialogs partagés pour les erreurs et suppressions

### Fixed

- Les erreurs de completion IA utilisent désormais le `Dialog` partagé au lieu de dialogs navigateur natifs.
- La suppression de fichiers et dossiers utilise une confirmation accessible avec restauration du focus, tout en conservant le bypass des actions dangereuses autorisées.

## [4.11.0] — Types explicites sur les boutons

### Fixed

- Les boutons d’action du client déclarent désormais explicitement `type="button"` (ou `type="submit"` pour la sauvegarde du formulaire), afin d’éviter les soumissions implicites et les comportements ambigus.

## [4.10.0] — Swap ChatInterface sous feature flag

### Fixed

- Le flag `chatInterfaceSwap` monte désormais le conteneur `ChatInterface` complet avec streaming spécialisé, composer, suggestions, édition et feedback conservés.
- Les interactions avancées du composer restent pilotées par le pipeline legacy pendant la phase de déploiement progressif.

## [4.9.0] — Dialog de variables MCP

### Fixed

- La saisie des variables d’environnement lors des ajouts MCP utilise désormais un dialog partagé avec support clavier et champ secret, sans `window.prompt`.
- Les actions MCP modifiées déclarent explicitement leur type de bouton.

## [4.8.0] — Dialogs de session accessibles

### Fixed

- Le renommage et la suppression d’une conversation utilisent désormais le `Dialog` partagé avec confirmation explicite, focus clavier et restauration du focus, sans `window.prompt` ni `window.confirm`.

## [4.7.0] — Dialogs de confirmation des workflows

### Fixed

- Les confirmations d’installation groupée et de suppression de workflow utilisent désormais le `Dialog` partagé et ne dépendent plus de `window.confirm`.
- Les actions interactives du WorkflowManager déclarent explicitement leur type de bouton.

## [4.6.0] — Dialog de création dans l’explorateur

### Fixed

- La création d’un fichier ou dossier dans un sous-dossier utilise désormais le `Dialog` partagé avec focus, validation et boutons accessibles au clavier, au lieu de `window.prompt`.

## [4.5.1] — Garde-fou des contrats UI

### Added

- Ajout d’un gate CI cross-platform qui empêche la remontée des boutons sans `type`, dialogs natifs, cibles `onClick` non sémantiques et attributs `title` hérités.

## [4.5.0] — Selects natifs cohérents

### Fixed

- Les `<select>` natifs utilisent désormais `appearance: none`, une flèche cohérente avec le thème actif et un anneau `:focus-visible` tokenisé, avec conservation du rendu distinct des listes multiples.

## [4.4.0] — Focus clavier sur les contrôles CSS ciblés

### Fixed

- Ajout d’anneaux `:focus-visible` cohérents sur les contrôles interactifs du graphe, de l’aperçu live, du terminal, de l’écran d’erreur et du rendu Markdown.

## [4.3.0] — UI Kit/a11y : contrôles de toolbar sûrs

### Fixed

- Les `IconButton` et `Pill` interactifs du UI Kit utilisent désormais `type="button"` par défaut afin de ne pas soumettre accidentellement un formulaire.
- Les actions de l’explorateur de fichiers utilisent aussi un type explicite, y compris les créations, résultats de recherche, suppressions et actions du menu contextuel.
- Les `IconButton` sans libellé visible récupèrent un nom accessible depuis leur titre, tout en conservant la possibilité de fournir un `aria-label` explicite.
- Ajout de tests de contrat pour le type et le nom accessible des contrôles partagés.

## [3.4.0] — Sélecteur d'effort de raisonnement

### Added

- Sélecteur d'effort de raisonnement dans la barre de saisie du chat (Auto / Faible / Moyen / Élevé / Ultra), façon Codex / Claude Code.
- L'effort aiguille le routeur vers un profil interne **plancher** (low→luna, medium→sol, high/ultra→opus) sans jamais exposer ces profils à l'utilisateur.
- Le plancher s'applique sur les chemins BYOK/local (route-request) et managed Neven (gateway), ainsi que sur tous les replis du routeur.

### Security

- L'effort n'est ni un modèle ni une clé : la source de vérité reste le fichier de settings du main process (liste fermée validée), jamais injectable depuis le renderer.

## [3.3.3] — Hardening du routage managed

### Security

- L’ancienne route managed sans grant est désactivée ; le gateway Neven est l’unique entrée d’exécution.
- Les modes chat, inline et ghost partagent la même policy et les erreurs gateway indisponibles déclenchent le fallback autorisé.
- Les métadonnées provider/modèle restent server-side dans la réponse managed.

## [3.3.2] — Refus vérifiables du flux managed COD-36 / COD-26

### Security

- Le harness local prouve l'absence de fallback fournisseur sur les grants expirés ou révoqués, le refus d'appareil et l'indisponibilité serveur du provider ou du modèle.
- Les échecs mockés ne renvoient ni prompt, ni métadonnée renderer sensible dans l'IPC ou les logs capturés.

## [3.2.0] — Harness managed local COD-36

### Added

- Harness d'intégration main-process local pour le flux managed Neven : resolve, gateway et réponse texte sans provider réel.

### Security

- Vérifie que provider, modèle, grant et clé ne traversent pas le renderer, l'IPC ou le payload gateway, y compris sur les refus et erreurs simulés.

## [3.1.0] — Contrat gateway Neven COD-34

### Changed

- Alignement strict resolve/revoke/gateway sur le contrat COD-33, avec grant et sujet gardés exclusivement dans le main process.
- Les modes chat, inline et ghost sont transmis à la gateway ; local et BYOK sont décidés avant toute résolution Neven.

### Security

- Cache de grants cloisonné par workspace, appareil, profil et capacité ; payload gateway plat et borné, sans provider, modèle ni clé.

## [2.9.0] — Cycle de vie sécurisé des credentials (COD-19)

### Added

- Service main-process de création, remplacement, rotation, révocation et test de connectivité des credentials, avec registre de fournisseurs fermé.
- Journal d’audit credential séparé du ledger d’usage, limité à un `operationId` et des codes de résultat bornés.

### Security

- Métadonnées publiques en whitelist stricte ; aucune clé, token, mot de passe ou valeur chiffrée ne traverse l’IPC.
- Mutations sérialisées et CASées sur la révision attendue ; rollback limité à la révision écrite par l’opération, sans réactivation d’un tombstone concurrent.
- Les IPC de liste, révocation et connectivité utilisent exclusivement le contexte workspace dérivé du main process et un `credentialId`.
- La connectivité relit et utilise le secret sous verrou du coffre ; une révocation concurrente ou un cache périmé bloque tout appel réseau.
- Azure et Ollama local sont gérables dans le coffre (cycle de vie et audit), mais restent non résolubles par le runtime : le contrat refuse explicitement Azure et Ollama local, y compris via l’alias `ollama`, avant toute résolution ou invocation d’adaptateur. Ils retournent `unsupported` en connectivité, sans appel réseau, tant qu’un adaptateur sûr n’existe pas.
- Les alias runtime `claude`/`gemini` sont canoniquement résolus vers `anthropic`/`google`; les coffres v1 sans index sont migrés explicitement au premier chargement.
- L’audit et les tombstones du coffre utilisent une écriture temporaire synchronisée puis renommée atomiquement; l’audit se verrouille entre processus, nettoie son acquisition partielle et ne récupère qu’un lock dont le processus propriétaire est prouvé mort.
- `lastUsedAt` et les quotas `maxRequestsPerMinute`/`maxRequestsPerDay` sont appliqués à la résolution BYOK. La planification de rotation reste hors périmètre COD-19 (elle relève de Neven).

## [2.8.0] — Passerelle managed Neven (COD-26A)

### Added

- Contrat backend injectable resolve/revoke/complete pour les grants Neven et la passerelle managed.
- Rejeu unique après expiration d’un grant, sans conversion du grant en clé fournisseur.

### Security

- Requêtes gateway HTTPS sous allowlist, redirections refusées, bearer main process et payload sans provider.
- Cache mémoire purgé localement avant toute révocation distante, y compris en cas d’échec réseau.

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
