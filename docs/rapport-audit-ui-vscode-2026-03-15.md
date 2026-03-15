# Audit du projet Mon IDE Agent IA

Date: 15 mars 2026

## Perimetre

Audit base sur le code du projet Electron/React et sur l'UX visible dans les composants principaux:

- shell Electron et IPC
- UI principale React
- explorateur, editeur, terminal, git, preview
- chat IA et workflows visuels
- positionnement par rapport a VS Code

## Synthese executive

Mon IDE Agent IA n'est pas aujourd'hui un concurrent direct de VS Code sur le terrain "IDE generaliste". Le produit est plus proche d'un poste de travail IA oriente taches, avec un bon angle de differenciation sur:

- l'edition assistee par IA
- l'application/rejet de patchs
- les snapshots IA
- l'integration Ollama
- les workflows visuels

En revanche, l'ecart reste important avec VS Code sur les fondamentaux d'IDE:

- robustesse des fonctions de base
- profondeur de l'editeur
- ecosysteme d'extensions
- outils de debug
- qualite de navigation projet
- confiance dans l'execution

Conclusion produit:

- le projet a deja une identite forte comme IDE desktop AI-native
- l'ambition de se rapprocher de VS Code est legitime
- pour y parvenir, il faut renforcer les fondamentaux IDE sans diluer la differenciation IA

## Forces actuelles

- UI differenciante et clairement AI-first, avec une topbar riche et un panneau IA central dans l'experience.
- Integration native d'Ollama et mode multi-agents, rare pour une app desktop de ce type.
- Systeme de modifications IA avec pending changes, diff, snapshots et quality gates: c'est une bonne base de confiance utilisateur.
- Presence d'une palette de commandes, d'une palette de fichiers, d'une recherche projet, d'un terminal integre, d'un panneau Git et d'un preview live.
- Editeur Monaco avec diff viewer, inline completion et ghost completion.
- Workflows visuels integrant IA, terminal et persistance locale: c'est un angle produit fort que VS Code n'offre pas nativement.

## Constats critiques

### 1. Le selecteur de modele IA dans les workflows visuels est trompeur

Le noeud IA du workflow propose `Gemini`, `Kimi K2.5` et `Ollama`, mais l'execution passe toujours par `getGeminiCompletion`.

References:

- `client/src/hooks/useWorkflowRunner.js:141`
- `client/src/hooks/useWorkflowRunner.js:145`

Impact:

- l'UI promet plusieurs providers
- le comportement reel ne respecte pas ce choix
- la confiance utilisateur baisse immediatement

### 2. Les commandes workflow cassent facilement sur Windows et sur les chemins avec espaces

Les commandes sont decoupees avec `command.split(' ')`.

Reference:

- `client/src/hooks/useWorkflowRunner.js:113`

Impact:

- `C:\Program Files\...`
- arguments quotes
- commandes shell un peu complexes

En pratique, c'est beaucoup plus fragile que le terminal de VS Code.

### 3. Le moteur de logique execute du JavaScript libre dans le renderer

Le noeud logique evalue la condition via `new Function(...)`.

Reference:

- `client/src/hooks/useWorkflowRunner.js:161`

Impact:

- surface de risque forte si un workflow est importe ou partage
- execution non sandboxee
- comportement difficile a auditer

### 4. La preview live a une logique d'auto-reload incoherente

Le commentaire dit "Auto-reload quand le status passe a running", mais la condition `isRunning && (isStopped || iframeState.error)` ne peut pas detecter proprement la transition vers `running`.

Reference:

- `client/src/components/LivePreview/index.js:53`

Impact:

- preview moins fiable
- sentiment d'instabilite
- besoin d'actions manuelles inutiles

### 5. La boucle de dev Electron n'est pas a la hauteur

Le script de dev Electron attend simplement quelques secondes puis lance Electron, sans watcher du process main/preload.

References:

- `package.json:8`
- `package.json:14`

Impact:

- changements `main.js` et `preload.js` non repris automatiquement
- etats incoherents entre renderer et main process
- debugging plus lent

### 6. Le niveau de test est insuffisant pour un produit IDE

Le seul test visible cote client est un smoke test tres basique.

Reference:

- `client/src/App.test.js:5`

Contexte complementaire:

- `main.js` fait 7301 lignes
- `client/src/App.js` fait 1919 lignes
- `client/src/hooks/useAI.js` fait 1956 lignes

Impact:

- fort risque de regressions UI
- refactors difficiles
- bugs de coordination entre panneaux, IA, preview et Git

## Audit UI / UX

### Positionnement visuel

Le style est plus affirmatif et plus "produit IA" que VS Code. C'est positif. L'app a une vraie personnalite visuelle.

Mais l'interface reste dense. Le probleme principal n'est pas le look; c'est la charge cognitive:

- beaucoup de controles en topbar
- plusieurs modes IA
- plusieurs vues centrales
- panneau droit tres riche
- etats multiples en parallele

VS Code gagne ici par hierarchie visuelle et predictibilite. Meme avec beaucoup de fonctions, chaque zone a un role stable.

### Explorateur de fichiers

Points positifs:

- arborescence recursive
- creation/suppression
- filtre

Ecart avec VS Code:

- pas de menu contextuel riche
- pas de drag and drop visible
- pas de renommage inline dans l'explorateur
- pas de decorations avancees
- pas de multi-selection

L'explorateur est fonctionnel mais reste en dessous du standard IDE.

### Editeur

Points positifs:

- Monaco
- tabs
- diff editor
- inline IA

Ecart avec VS Code:

- pas d'integration LSP detectee dans le code
- pas d'extension host detecte
- pas de debugger
- pas d'outline / breadcrumbs / symbol navigation compares au niveau VS Code
- pas de split editors natifs visibles

En pratique, l'editeur est bon pour modifier vite avec IA, pas encore pour de la navigation et du dev intensif longue duree.

### Panneau IA

C'est la partie la plus differenciante du produit.

Points forts:

- workflow de conversation
- contexte projet
- flux de streaming
- gestion des pending changes
- providers multiples

Point faible UX:

- beaucoup de modes et d'etats au meme endroit
- les utilisateurs doivent comprendre plusieurs couches: provider, agent, skill, contexte, permissions, pending changes, workflows

Le panneau IA ressemble aujourd'hui a un cockpit. Pour un expert, c'est riche. Pour un usage quotidien, c'est plus lourd que VS Code + extension IA.

### Terminal et preview

Le terminal integre est utile mais reste un orchestrateur de processus, pas encore un terminal aussi mature que celui de VS Code.

Le preview live est une bonne idee pour les projets web, mais il n'atteint pas la robustesse d'un couple VS Code + navigateur + extension live reload.

### Git

Le panneau Git couvre les operations essentielles:

- status
- add
- commit
- push/pull
- branches
- stash

Mais il reste plus procedural que VS Code:

- moins de feedback visuel
- diff moins integre a l'editeur
- moins de confort sur les cycles de revue

## Ecart avec VS Code

### La ou Mon IDE Agent IA est meilleur

- orchestration IA native dans l'interface
- integration locale Ollama / multi-modeles
- validation explicite des changements IA
- snapshots IA
- workflows visuels integres au produit

### La ou VS Code reste loin devant

- stabilite globale
- editeur et navigation
- language services
- ecosysteme d'extensions
- debugging
- ergonomie du terminal
- maturite Git
- accessibilite et cohérence interactionnelle

### Positionnement recommande

Le produit peut garder son ambition de devenir une alternative credibile aux IDE classiques, tout en assumant un positionnement distinct.

Le positionnement le plus juste aujourd'hui est:

- un IDE desktop AI-native
- specialise dans la production, la transformation et l'orchestration de code
- avec workflow visuel et execution locale
- pense pour completer puis concurrencer progressivement les usages couverts aujourd'hui par VS Code

Autrement dit:

- il ne s'agit pas de renoncer au terrain IDE
- il s'agit de l'aborder avec une proposition de valeur differente, plus IA, plus orchestration, plus execution

## Priorites recommandees

### P0

- Corriger le routage provider des noeuds IA workflow.
- Corriger l'execution des commandes shell workflow avec parsing robuste.
- Corriger l'auto-reload du preview.
- Supprimer `new Function` ou le confiner a un evaluateur plus sur.
- Mettre un vrai watcher/reloader Electron en dev.

### P1

- Decouper `main.js`, `App.js` et `useAI.js`.
- Ajouter tests unitaires sur hooks et composants critiques.
- Ajouter tests d'integration sur le flux "IA -> pending changes -> apply/reject".
- Rendre l'explorateur plus proche d'un IDE: rename inline, context menu, drag and drop.
- Renforcer l'editeur: navigation symbolique, meilleure recherche, meilleur couplage diff/editor.

### P2

- Clarifier les modes IA par niveau d'utilisateur.
- Simplifier la topbar.
- Renforcer les workflows visuels comme fonctionnalite signature.
- Formaliser un systeme d'extensions ou au minimum de plugins internes.

## Verdict

Le projet a deja une vraie valeur et une direction produit credible.

Il peut viser plus haut et se rapprocher d'un niveau "VS Code-compatible" dans les usages, a condition de renforcer fortement:

- la robustesse
- les fondamentaux d'IDE
- la coherence d'execution
- la confiance utilisateur

La bonne trajectoire n'est pas de copier VS Code a l'identique, mais de garder le positionnement AI-native du produit tout en atteignant un niveau de fiabilite et de confort qui permette une comparaison serieuse.
