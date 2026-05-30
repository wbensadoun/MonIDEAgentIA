# Cerveau De Reprise - Transparence IA

Date: 2026-05-30

Ce fichier sert de mémoire factuelle pour reprendre l'implémentation sans halluciner l'état du projet.

## Objectif

Implémenter le plan de transparence IA de l'IDE: rendre les modifications de code proposées par l'IA visibles, persistantes, auditables, vérifiables et réversibles.

## État Global

L'implémentation est bien avancée et compile. Les tests passent.

Ce qui existe maintenant:
- Un domaine persistant `AgentRun` côté Electron.
- Des IPC `agent:*` exposés au renderer via `preload.js`.
- Un panneau central `AI Changes`.
- Une trace auditée des propositions, acceptations, rejets, conflits, vérifications et rollbacks.
- Une vérification post-écriture par relecture du fichier.
- Une correction du bug où `App.js` forçait toujours `edit_terminal`.

## Fait Dans Cette Session

### Backend Electron

Fichier principal: `main.js`

Ajouté:
- Import `crypto`.
- Stockage des runs IA dans `app.getPath('userData')/agent-runs/<projectHash>/<runId>.json`.
- Normalisation des runs, changes et logs.
- Hash SHA-256 du contenu pour `baseHash` et vérifications.
- IPC:
  - `agent:listRuns`
  - `agent:getRun`
  - `agent:createRun`
  - `agent:updateRun`
  - `agent:appendLog`
  - `agent:updateChangeStatus`
  - `agent:applyChange`
  - `agent:rejectChange`
  - `agent:restoreRun`
- Événement renderer `agent:action` quand un run est mis à jour.
- `agent:applyChange` écrit le fichier, relit le contenu et marque `verified` seulement si le contenu relu correspond au contenu attendu.
- `agent:restoreRun` restaure les anciens contenus des changements du run.

### Preload

Fichier: `preload.js`

Ajouté à `window.electronAPI`:
- `agentListRuns`
- `agentGetRun`
- `agentCreateRun`
- `agentUpdateRun`
- `agentAppendLog`
- `agentUpdateChangeStatus`
- `agentApplyChange`
- `agentRejectChange`
- `agentRestoreRun`
- `onAgentAction`

### Diff Utilities

Nouveau fichier: `client/src/utils/aiDiff.js`

Ajouté:
- `buildLineDiff`
- `buildDiffHunks`
- `summarizeDiff`
- `buildContentFromSelectedHunks`

Nouveau test: `client/src/utils/aiDiff.test.js`

Tests couverts:
- Changement d'un seul mot.
- Application partielle de hunks sélectionnés.

### Intégration IA Existante

Fichier: `client/src/hooks/useAIPendingChanges.js`

Ajouté:
- Création automatique d'un `AgentRun` quand l'IA propose des fichiers.
- Calcul additions/suppressions/hunks pour chaque proposition.
- Lien `runId` / `runChangeId` sur les pending changes.
- Logs de snapshot.
- Status `verified`, `failed`, `conflict`, `rejected`, `rolled_back`.
- Vérification post-write avec `readFile`.
- Support d'un contenu override pour appliquer une sélection partielle de hunks.
- Export de:
  - `activeAgentRunId`
  - `agentRunRefreshKey`
  - `updatePendingChangeContent`

Attention: le flux historique `writeFile/createNewFile` reste le chemin principal pour les pending changes. Le nouveau backend `agent:applyChange` sert surtout aux runs persistants déjà enregistrés qui ne sont plus dans la file locale.

### Hook IA

Fichier: `client/src/hooks/useAI.js`

Ajouté:
- Passage de métadonnées à `processAIFileModifications`:
  - prompt
  - provider
  - model
  - summary
- Exposition de:
  - `activeAgentRunId`
  - `agentRunRefreshKey`
  - `updatePendingChangeContent`

### Nouveau Panneau UI

Nouveaux fichiers:
- `client/src/components/AIChangesPanel/index.js`
- `client/src/components/AIChangesPanel/AIChangesPanel.css`

Fonctions UI:
- Liste des runs IA persistants.
- Liste des fichiers modifiés par run.
- Statuts visibles: propose, partiel, vérifié, rejeté, conflit, échec, rollback.
- Diff Monaco par fichier.
- Sélection de hunks par checkbox.
- Boutons:
  - appliquer
  - appliquer sélection
  - rejeter
  - rollback run
  - refresh
- Journal d'audit du run.

### App Shell

Fichier: `client/src/components/AppShell/WorkspaceLayout.js`

Ajouté:
- Import `AIChangesPanel`.
- Nouvel onglet central `AI Changes`.
- Icône `IconAudit`.
- Rendu du panneau `AIChangesPanel`.

### App State

Fichier: `client/src/App.js`

Ajouté:
- State:
  - `agentRuns`
  - `activeAgentRun`
  - `selectedAgentRunId`
  - `isAgentRunsLoading`
- Fonctions:
  - `loadAgentRun`
  - `loadAgentRuns`
  - `handleSelectAgentRun`
  - `refreshAgentRunAfterMutation`
- Abonnement à `onAgentAction`.
- Passage des props à `AIChangesPanel`.
- Ouverture automatique de l'onglet `AI Changes` quand un nouveau run IA est créé.
- Correction permission mode:
  - avant: `setPermissionMode('edit_terminal')`
  - maintenant: `setPermissionMode(settings.permissionMode || 'edit_terminal')`

### Status Et Chat

Fichiers:
- `client/src/components/AppShell/StatusBar.js`
- `client/src/components/AIChat/index.js`
- `client/src/components/AIChat/AIChat.css`

Ajouté:
- Badge status bar `IA review: N`.
- Correction du label permission: `edit` est maintenant affiché comme `Édition`.
- Le panneau pending changes du chat affiche tous les changements, plus seulement les 8 premiers.
- La liste pending est scrollable.

## Mise A Jour De Reprise

Apres reprise depuis ce fichier:
- Ajout de l'export de run depuis `AI Changes`:
  - bouton `Export JSON`;
  - bouton `Export MD`;
  - export via fichier telecharge dans le renderer.
- Ajout du test UI `client/src/components/AIChangesPanel/AIChangesPanel.test.js`.
- Ajout d'un test de regression dans `client/src/App.test.js`:
  - `permissionMode: read_only` charge depuis settings;
  - l'UI affiche bien `Lecture seule`;
  - cela verifie que l'app ne force plus `edit_terminal`.

## Mise A Jour Revue Par Ligne

Ajouté après le smoke dev:
- Le moteur `aiDiff` donne maintenant des identifiants stables aux lignes modifiées.
- `AI Changes` permet de cocher/décocher les lignes ajoutées/supprimées dans chaque hunk.
- Un hunk peut être complet, vide ou partiel.
- `Appliquer selection` construit un contenu partiel ligne par ligne.
- Les remplacements multi-lignes sont appariés par position pour éviter de réordonner les lignes lors d'une sélection partielle.

Tests ajoutés:
- `aiDiff.test.js`: sélection de lignes dans un remplacement multi-lignes.
- `AIChangesPanel.test.js`: décocher une paire de lignes et appliquer seulement le reste.

## Validation Déjà Faite

Commande:
```bash
node -c main.js
```
Résultat: OK.

Commande:
```bash
npm test --prefix client -- --watchAll=false --runInBand
```
Résultat:
- 12 test suites passées.
- 34 tests passés.
- Warnings connus de Testing Library / `ReactDOMTestUtils.act`.

Commande:
```bash
npm run build --prefix client
```
Résultat:
- Build compilé.
- Warnings restants uniquement dans `client/src/components/FileExplorer/index.js`:
  - `projectName` unused
  - `handleKeyPress` unused

Ces warnings ne viennent pas de cette fonctionnalité.

## Mise A Jour Smoke Dev

Problème trouvé:
- Le shell de dev avait `ELECTRON_RUN_AS_NODE=1`.
- `scripts/electron-dev-runner.js` transmettait cet env à Electron.
- Résultat: Electron démarrait comme Node pur, donc `app.whenReady()` était `undefined`.

Correction:
- `scripts/electron-dev-runner.js` filtre maintenant `ELECTRON_RUN_AS_NODE` avant de lancer le binaire Electron.
- Le runner force aussi `ELECTRON_DEV_SERVER_URL` dans l'env enfant.

Validation:
- `node -c scripts/electron-dev-runner.js`: OK.
- `Invoke-WebRequest http://127.0.0.1:3004`: `200`.
- `npm run electron-dev`: Electron démarre, crée la fenêtre principale, charge `http://127.0.0.1:3004`, et `preload.js` expose les IPC `agent*`.
- Après les changements ligne par ligne, `http://127.0.0.1:3004` répond toujours `200`.

## Mise A Jour Finalisation Transparence

Ajouté après le plan de finalisation:
- Le `DiffEditor` Monaco du panneau `AI Changes` active maintenant le gutter.
- Les lignes ajoutées/supprimées ont une décoration gutter cliquable.
- Cliquer le gutter d'une ligne IA bascule la sélection de cette ligne.
- Les lignes sélectionnées restent mises en évidence; les lignes exclues sont atténuées.
- Les hunks affichent clairement les états complet, partiel ou vide.
- Les checkboxes de revue ligne par ligne restent le fallback accessible et la source de vérité.
- L'export de run est extrait dans `client/src/utils/aiRunExport.js`.
- Les exports JSON/Markdown sont testés sans dépendre du téléchargement DOM.
- Le mode `read_only` est aussi couvert côté `Settings`.

Tests ajoutés/étendus:
- `AIChangesPanel.test.js`: clic gutter Monaco, état visuel sélectionné/exclu, application partielle ligne par ligne.
- `aiRunExport.test.js`: payload JSON, payload Markdown, fallbacks Markdown.
- `Settings.test.js`: sauvegarde de `permissionMode: read_only`.

Validation finale:
- `node -c main.js`: OK.
- `node -c scripts/electron-dev-runner.js`: OK.
- `npm test`: 13 suites passées, 39 tests passés.
- `npm run build --prefix client`: build compilé; warnings restants uniquement dans `FileExplorer` (`projectName`, `handleKeyPress` unused).
- `npm run dev`: renderer compilé, `http://127.0.0.1:3004` répond `200`, Electron démarre et `preload.js` expose les IPC `agent*`.

## Ce Qui Reste À Faire

Manuel, dépendant d'un provider IA configuré et d'une interaction dans la fenêtre Electron:
- Demander à l'IA de changer un seul mot.
- Vérifier que l'onglet `AI Changes` s'ouvre automatiquement.
- Vérifier visuellement run, fichier, diff, hunk, gutter ligne, apply, reject et journal d'audit.
- Appliquer et confirmer dans l'UI que le fichier est relu et marqué `verified`.
- Refaire le parcours en mode `Lecture seule` depuis Settings pour confirmer le blocage utilisateur final.
- Générer un conflit réel en modifiant le fichier à la main avant apply, puis vérifier `conflict`.
- Tester rollback run sur un fichier existant et sur un fichier créé.

Important:
- Aucun point technique important du plan de finalisation ne reste ouvert côté code/tests automatisés.

À surveiller:
- Le backend `agent:applyChange` vérifie par `baseHash`, tandis que le flux pending historique vérifie surtout par `mtime`. Les deux coexistent.
- Pour les pending changes, l'application passe toujours par `writeFile/createNewFile`; `AgentRun` sert d'audit et de miroir d'état.
- Le worktree était déjà sale avant cette implémentation. Ne pas supposer que tous les changements dans `git status` viennent de cette session.

## Fichiers Créés

- `client/src/components/AIChangesPanel/index.js`
- `client/src/components/AIChangesPanel/AIChangesPanel.css`
- `client/src/components/AIChangesPanel/AIChangesPanel.test.js`
- `client/src/utils/aiDiff.js`
- `client/src/utils/aiDiff.test.js`
- `client/src/utils/aiRunExport.js`
- `client/src/utils/aiRunExport.test.js`
- `docs/cerveau-transparence-ia-2026-05-30.md`

## Fichiers Modifiés Par Cette Fonctionnalité

- `main.js`
- `preload.js`
- `client/src/App.js`
- `client/src/App.test.js`
- `client/src/hooks/useAI.js`
- `client/src/hooks/useAIPendingChanges.js`
- `client/src/components/AppShell/WorkspaceLayout.js`
- `client/src/components/AppShell/StatusBar.js`
- `client/src/components/AIChat/index.js`
- `client/src/components/AIChat/AIChat.css`
- `client/src/components/Settings/Settings.test.js`
- `scripts/electron-dev-runner.js`

## Prochaine Reprise Recommandée

1. Relire ce fichier.
2. Lancer:
   ```bash
   node -c main.js
   node -c scripts/electron-dev-runner.js
   npm test --prefix client -- --watchAll=false --runInBand
   npm run build --prefix client
   ```
3. Utiliser l'app sur `http://127.0.0.1:3004` pour faire le smoke fonctionnel IA manuel si un provider est configuré.
4. Corriger uniquement les problèmes UX/runtime trouvés pendant ce smoke manuel.
