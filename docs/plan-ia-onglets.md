# Plan — architecture d'onglets

**Principe directeur :** le centre ne contient que des **documents**. Les **outils** vivent à gauche (Activity Bar), en bas (Panel) ou à droite (panneau de chat). Un outil ne devient jamais un onglet.

C'est la règle qui structure VS Code et Codex, et c'est la seule chose à retenir : chaque fois qu'on hésite sur l'emplacement de quelque chose, on demande « est-ce un document que j'ouvre et que je ferme, ou un outil que je consulte ? ».

**Périmètre.** Réorganisation de l'architecture de l'information. Pas de refonte visuelle (déjà traitée), pas de nouvelle fonctionnalité métier.

---

## 1. Arborescence cible

```
┌─ TOPBAR (40px) ─────────────────────────────────────────────────────┐
│ 🤖 Code Companion │ ●projet › fichier    [⌘K]   📁 ▷    ◧ ▤ ◨      │
└─────────────────────────────────────────────────────────────────────┘

ACTIVITY BAR      PRIMARY SIDEBAR       EDITOR GROUP        CHAT (droite)
(48px)            (contenu du choix)    (les documents)     (panneau)
──────────────    ─────────────────     ───────────────     ──────────────
📁 Explorateur ─▶ arbre fichiers        ┌──────────────┐    conversation
🔍 Recherche   ─▶ résultats             │  ONGLETS     │      ACTIVE
⑂  Git         ─▶ diffs · staging       │              │    ──────────────
✨ AI Changes  ─▶ fichiers en attente   │ App.js   ×   │    ⌚ historique
🔀 Flux        ─▶ liste des workflows   │ Aperçu   ×   │       des sessions
                                        │ 💬 Chat  ×   │    ➕ nouvelle
  ⟨bas⟩                                 │ ⚙ Param. ×   │    ⛶ ouvrir en
⚙  Paramètres ─▶ ouvre un ONGLET        └──────────────┘       onglet
                                        + fil d'Ariane
                                               │
                                      ┌────────▼──────────────────────┐
                                      │ PANEL : Terminal · 🧠 Brain   │
                                      └───────────────────────────────┘
                                      ┌───────────────────────────────┐
                                      │ STATUS BAR                    │
                                      └───────────────────────────────┘
```

---

## 2. Le modèle d'onglet

```js
{ type: 'file',       path: 'src/App.js' }   // n exemplaires — existe déjà
{ type: 'preview'     }                       // singleton
{ type: 'chat',       sessionId: 'abc123' }   // n exemplaires
{ type: 'settings'    }                       // singleton
{ type: 'agentverse'  }                       // singleton — voir §5.1
```

**Un seul système d'onglets, cinq types de contenu.** Pas de second système pour les chats.

### Règles du modèle

| Règle | Détail |
|---|---|
| **Identité** | `type` + son discriminant (`path` pour un fichier, `sessionId` pour un chat). Deux onglets ne peuvent pas partager la même identité. |
| **Singleton** | `preview`, `settings`, `agentverse` : rouvrir revient à basculer sur l'onglet existant, jamais à en créer un second. |
| **Ordre** | Ordre d'ouverture. Le réordonnancement par glissement est hors périmètre (§9). |
| **Onglet actif** | Un seul index actif, partagé par tous les types. |
| **Fermeture** | Un onglet `file` non enregistré demande confirmation (`dirtyFiles` existe déjà). Les autres types se ferment sans question. |
| **Dernier onglet** | Fermer le dernier laisse un état vide explicite (`.editor-tabs-empty` existe déjà : « Ouvrez un fichier (Ctrl+P) »). Ne jamais rendre l'application inutilisable. |
| **Persistance** | Les onglets survivent au redémarrage. Un `chat` restaure sa session, un `file` son chemin. |

---

## 3. ⚠ Ce qui existe DÉJÀ — à ne pas reconstruire

**Section la plus importante du plan.** Un agent qui ne la lit pas va réécrire du code qui fonctionne.

| Brique | Emplacement | État |
|---|---|---|
| Liste des onglets | `useEditorSession.js:25` → `openFiles: string[]` | ✅ |
| Onglet actif | `useEditorSession.js:23` → `activeFile` | ✅ |
| **Rendu des onglets** | `CodeEditor/index.js:430-465` (`.editor-tabs`) | ✅ **imbriqué dans la vue Code** |
| Point « non enregistré » | `useEditorSession.js:29` → `dirtyFiles: Set` + `markFileDirty`/`clearFileDirty` | ✅ |
| Bouton fermer | `CodeEditor/index.js:450-461` | ✅ |
| Fil d'Ariane | `CodeEditor/index.js:467-474` (langue, nb de lignes) | ✅ |
| Persistance des onglets | `useWorkspaceSessionLayout.js:224` | ✅ |
| Ctrl+P → ouvrir un fichier | `useCommandCenter.js:263` | ✅ |
| Styles d'onglets | `.editor-tab*` dans `CodeEditor.css` | ✅ |
| Panneaux persistants (pas de démontage au changement) | `WorkspaceLayout.js` `PersistentPane` + `.center-view-pane` | ✅ |
| Chargement paresseux d'AgentVerse | `AppShell/lazyAgentVerse.js` | ✅ |

**Le travail n'est pas de créer un système d'onglets. Il est de le remonter d'un niveau et de lui faire accepter autre chose que des fichiers.**

### Ce qui manque réellement

| Manque | Coût |
|---|---|
| Sessions de chat multiples — `useAIConversationSession.js` n'a qu'une conversation plate | **le seul vrai chantier** |
| Généraliser `openFiles: string[]` → `openTabs: Tab[]` | mécanique, 8 points de lecture |
| Panel du bas avec onglets — aujourd'hui c'est le Terminal seul, sans bandeau | petit |
| `Ctrl+W` (fermer l'onglet), `Ctrl+Tab` (cycler) | **absents**, à ajouter |

---

## 4. Redistribution des six onglets d'outils

`CENTER_TABS` (`WorkspaceLayout.js:18-25`) disparaît. Destination de chaque entrée :

| Onglet actuel | Destination | Pourquoi |
|---|---|---|
| `code` | ∅ — c'est l'éditeur | Un éditeur n'est pas un onglet, il *contient* les onglets |
| `preview` | **onglet** `{type:'preview'}` | Un aperçu est un document (cf. Live Preview de VS Code) |
| `git` | Activity Bar (le bouton existe déjà) | Doublon actuel : le bouton Source Control saute vers cet onglet |
| `ai-changes` | Activity Bar, nouvelle vue de sidebar | C'est **le moment critique** : il doit être une liste persistante, pas un onglet qu'on perd de vue |
| `brain` | **Panel** (bas), à côté du Terminal | Outil d'inspection, même famille que Terminal/Sortie |
| `workflows` | Activity Bar (liste) + onglet par workflow | Un workflow s'édite : la liste est un outil, le workflow un document |

---

## 5. Les étapes

Cinq étapes, de la moins chère à la plus chère. **Chacune est livrable seule et laisse l'application fonctionnelle.**

### ① Supprimer `viewMode` · *risque faible, diff négatif*

`viewMode` (`useAppUiState.js:30`) a trois valeurs qui se dissolvent toutes dans des états **déjà existants** :

| Valeur | Devient | Où |
|---|---|---|
| `'ide'` | ∅ — c'est l'application | — |
| `'chat'` | `isChatMaximized` | `useWorkspaceSessionLayout.js:144` ✅ existe |
| `'agents'` | onglet `{type:'agentverse'}` | §5.1 ci-dessous |

**À supprimer :** le `useState` (`:30-36`), l'effet de persistance (`:55-61`), la synchro store (`:107`), les trois branches de rendu (`App.js:690/742/751`), et le fichier `ChatLayout.js`.

**Les boutons de l'Activity Bar restent**, seul leur effet change :

| Bouton | Avant | Après |
|---|---|---|
| 💬 AI Chat | `setViewMode('chat')` — recharge toute l'appli | `setIsRightCollapsed(false)` — ouvre le panneau droit |
| 🤖 Agents | `setViewMode('agents')` — recharge toute l'appli | ouvre l'onglet `{type:'agentverse'}` |

**Bug à corriger en passant :** `useAppUiState.js:32` **lit** `futurIA_viewMode` alors que `:57` **écrit** `code_companion_viewMode`. Les deux clés diffèrent depuis le commit de renommage `5f77545`. La préférence de vue n'a donc jamais été restaurée au redémarrage. Les deux disparaissent avec l'étape — ne pas « réparer » puis supprimer.

#### 5.1 — Statut d'AgentVerse

AgentVerse est **mis de côté** : on ne modifie **aucun fichier** de `client/src/agentverse/`.

Mais `viewMode` ne peut pas mourir tant qu'une de ses valeurs sert à afficher AgentVerse. La solution qui ne touche pas au module : **changer son hôte, pas son code**. `LazyAgentVerse` (`AppShell/lazyAgentVerse.js`) est monté dans un onglet `{type:'agentverse'}` au lieu d'un mode plein écran. Le chargement paresseux est déjà en place, donc Phaser ne se charge que si l'onglet est ouvert.

> **Risque à vérifier :** AgentVerse utilise Phaser (moteur de jeu, canvas). Un canvas mesure son conteneur au montage. Passer du plein écran à un onglet change ses dimensions — si le monde s'affiche tronqué ou à la mauvaise échelle, **replier sur la solution de repli** : garder `viewMode` avec deux valeurs (`'ide' | 'agents'`) et livrer le reste du plan. Ne pas modifier AgentVerse pour le faire entrer de force.

**Repli explicite :** si l'onglet AgentVerse ne fonctionne pas, l'étape ① est quand même livrable — seule la valeur `'chat'` disparaît, ce qui règle déjà le doublon de chat.

#### Tests impactés par ①

| Fichier | Tests | Sort |
|---|---|---|
| `ChatLayout.test.js` | **4** | **Supprimés avec le composant.** Ils testent une fonctionnalité retirée volontairement — ce n'est pas « modifier un test pour le faire passer ». |
| `AppTopbar.test.js:55` | 1 (`Chat view swaps the layout toggles`) | **Supprimé** : il n'y a plus de vue Chat. |
| `AppTopbar.test.js:129/141` | 2 (chat maximize) | **Conservés** — `isChatMaximized` survit. |

Total : **309 → 304 tests attendus** après ①. Toute autre baisse est une régression à investiguer.

---

### ② Remonter les onglets au niveau de la coquille · *risque faible*

Déplacer le bloc `.editor-tabs` de `CodeEditor/index.js:430-465` vers `WorkspaceLayout.js`, **à la place** de `.center-tabs`.

- `CENTER_TABS` (`:18-25`) supprimé, redistribution selon §4.
- Les styles `.editor-tab*` migrent de `CodeEditor.css` vers `App.css`. `.center-tab*` supprimé (y compris le liseré d'accent ajouté récemment).
- Le fil d'Ariane (`CodeEditor/index.js:467-474`) remonte aussi : il décrit le document actif, il appartient au niveau des onglets.
- `PersistentPane` / `.center-view-pane` **est conservé** : c'est ce qui empêche Monaco, l'iframe d'aperçu et React Flow de perdre leur état à chaque changement d'onglet. Les onglets doivent s'appuyer dessus, pas le remplacer.

**Créer le Panel du bas** avec un vrai bandeau : `Terminal` + `Brain`. Aujourd'hui `isTerminalOpen` affiche le terminal sans bandeau (`WorkspaceLayout.js:362-392`).

#### Tests impactés par ②

`WorkspaceLayout.test.js` — les 4 tests portent sur les onglets et les régions. Ils devront être **adaptés** (les onglets changent de nature), pas supprimés. Deux d'entre eux méritent d'être préservés à l'identique dans leur intention :
- `:54` « roving tab stop » — l'accessibilité clavier du bandeau doit survivre au déplacement.
- `:72` « only the active pane remains keyboard-reachable without remounting » — la garantie de non-démontage est ce qui protège l'état de Monaco.

---

### ③ Généraliser le modèle d'onglet · *risque moyen*

`openFiles: string[]` → `openTabs: Tab[]`.

**Les 8 points de lecture à adapter :**
`App.js:106`, `App.js:158`, `App.js:428`, `App.js:453`, `CodeEditor/index.js:14`, `CodeEditor/index.js:431`, `CodeEditor/index.js:434`, `useCommandCenter.js:263`, `useWorkspaceSessionLayout.js:224`.

**Migration de la persistance — point de vigilance.** Une session déjà enregistrée contient `openFiles` sous forme de `string[]`. À la relecture (`useWorkspaceSessionLayout.js:224`), mapper chaque chaîne vers `{type:'file', path}`. Un utilisateur existant ne doit **ni perdre ses onglets ni voir une erreur**. Écrire un test pour ce cas précis : ancien format en entrée, onglets valides en sortie.

**Premier type non-fichier livré : `{type:'preview'}`.** Singleton, le plus simple, il valide le modèle avant d'attaquer les chats.

---

### ④ Paramètres : modale → onglet · *risque faible*

`{type:'settings'}`, singleton. Le composant `Settings` existe : on change son hôte, pas son contenu.

**Brancher `McpSettings.js` au passage.** Le fichier existe (570 lignes de CSS, et son JS a été nettoyé de ses 29 emoji lors du polish) mais **n'est monté nulle part** — vérifié : aucune référence depuis `Settings/index.js` ni `App.js`. Ajouter la section à la liste (`Settings/index.js:36-41`).

Liste cible des sections :

```
⚙ Paramètres (onglet)
   ├ Général
   ├ Apparence      ← thèmes, récupérés de ComponentLibrary
   ├ Fournisseurs
   ├ Agents
   ├ Exécution
   ├ Permissions
   ├ Contexte
   ├ MCP            ← ⚡ débloque McpSettings.js
   ├ Extensions     ← nouveau, peut être une coquille vide annoncée
   └ Raccourcis     ← nouveau, alimenté par §7
```

`Extensions` et `Raccourcis` peuvent être livrés comme sections vides avec un message explicite. Une section vide annoncée vaut mieux qu'une fonctionnalité introuvable.

---

### ⑤ Sessions de chat + onglets de chat · *le vrai chantier*

**Le seul endroit du plan où l'on écrit du code réellement neuf.**

#### 5.5.1 — Modèle de session

`useAIConversationSession.js` n'a aujourd'hui **qu'une conversation plate** (`aiConversationHistory`, exposée via `App.js:247`). Introduire :

```js
sessions: [{ id, title, messages: [], createdAt, updatedAt }]
activeSessionId: string
```

Le **titre est dérivé du premier message utilisateur** (tronqué), jamais saisi à la main. Un champ « nommez votre conversation » est une friction que ni VS Code ni Codex n'imposent.

#### 5.5.2 — Le panneau droit

```
💬 AI Chat                          [⌚] [➕] [⛶]
─────────────────────────────────────────────────
   conversation ACTIVE
   (une seule, jamais d'onglets ici)
─────────────────────────────────────────────────
   composer
```

Le menu `⌚` déroule l'historique des sessions. Le panneau ne montre **jamais** plusieurs onglets — c'est ce qui distingue le panneau (une conversation qui suit le travail) de l'éditeur (n conversations qu'on compare).

#### 5.5.3 — Interactions session → onglet

C'est le point soulevé et absent de la version précédente du plan. **Trois chemins, par ordre de priorité :**

| # | Chemin | Statut |
|---|---|---|
| 1 | **Bouton `⛶`** sur chaque ligne de l'historique et dans l'en-tête du panneau (session active) | **requis** |
| 2 | **Menu contextuel** (clic droit / `⋮`) : `Ouvrir dans un onglet` · `Renommer` · `Dupliquer` · `Supprimer` | **requis** |
| 3 | **Glisser-déposer** de la ligne d'historique vers le bandeau d'onglets | **optionnel** |

```
⌚ Historique des sessions                    [➕]
  ├ 📋 Refonte du composant Chat      [⛶] [⋮]
  ├ 📋 Bug de contraste sur le bouton [⛶] [⋮]
  └ 📋 Migration des tokens           [⛶] [⋮]
```

**Comportements à respecter — SÉCURITÉ DES SESSIONS :**

- **Fermer un onglet chat** (le ×) → la session **reste en historique**. Seul le bouton « Supprimer » du menu contextuel efface une session définitivement.
- Ouvrir une session déjà présente en onglet → **basculer** sur cet onglet, ne pas en créer un second (règle du §2 sur l'identité).
- Le panneau droit **ne suit pas** l'ouverture : il reste sur la session active. Sinon on perd sa place en voulant simplement mettre une conversation de côté.
- Une session ouverte en onglet et affichée dans le panneau reste **une seule source de vérité** : deux vues du même `sessionId`, pas une copie. Un message envoyé depuis l'une apparaît dans l'autre.
- Supprimer une session ouverte en onglet → **confirmation d'abord**, puis fermer l'onglet et supprimer la session de l'historique.

**Aucune session n'est perdue sans action explicite (clic sur Supprimer + confirmation).**

**Sur le glisser-déposer :** si on le fait, c'est avec l'API HTML5 native (`draggable`, `onDragStart`, `onDrop`) — **aucune bibliothèque**. Le bouton `⛶` couvre déjà entièrement le besoin ; le glissement n'est qu'un raccourci pour utilisateur avancé. Il ne doit jamais être le **seul** moyen de faire quelque chose (règle d'accessibilité : tout ce qui se fait au glissement doit se faire au clavier).

---

## 6. Récapitulatif des déplacements

| Aujourd'hui | Demain |
|---|---|
| `viewMode: ide / chat / agents` | supprimé — absorbé par états existants |
| Chat plein écran (mode `chat`) | supprimé — le panneau droit + `isChatMaximized` |
| `ChatLayout.js` | supprimé |
| Onglets d'outils `.center-tabs` | supprimés — redistribués (§4) |
| Onglets de fichiers dans `CodeEditor` | remontés au niveau coquille |
| Paramètres en modale | onglet |
| `McpSettings.js` orphelin | onglet Paramètres › MCP |
| Thèmes dans `ComponentLibrary` | onglet Paramètres › Apparence |
| Brain en onglet centre | Panel du bas |
| Terminal sans bandeau | Panel du bas avec bandeau |
| Conversation unique | n sessions |
| AgentVerse plein écran | onglet singleton (repli §5.1 si Phaser résiste) |

---

## 7. Raccourcis clavier

**Existants à conserver :** `Ctrl+K` (palette), `Ctrl+P` (fichiers), `Ctrl+O` (dossier), `Ctrl+Shift+F` (recherche), `Ctrl+T` (terminal), `Ctrl+B` / `Ctrl+J` (bascules de panneaux).

**À ajouter — absents et attendus dans un IDE :**

| Raccourci | Action |
|---|---|
| `Ctrl+W` | Fermer l'onglet actif (confirmation si non enregistré) |
| `Ctrl+Tab` / `Ctrl+Shift+Tab` | Onglet suivant / précédent |
| `Ctrl+1..9` | Aller au n-ième onglet |

Ils alimentent la section `Raccourcis` de l'étape ④.

---

## 8. Discipline sur les tests

**Trois catégories, à ne pas confondre :**

1. **Test d'une fonctionnalité supprimée volontairement** → le test est supprimé avec elle. `ChatLayout.test.js` (4 tests) et `AppTopbar.test.js:55` entrent ici. C'est légitime et documenté au §5.①.
2. **Test d'un comportement déplacé** → le test est **adapté**, son intention préservée. `WorkspaceLayout.test.js` (4 tests) entre ici.
3. **Test qui casse sans raison identifiée** → **c'est une régression.** Réparer le code, jamais le test.

Toute suppression de test doit être **nommée dans le rapport d'étape** avec sa justification. Un compte de tests qui baisse sans explication est un échec de l'étape.

Compte attendu : 309 → **304** après ①, puis stable ou en hausse.

---

## 9. Ce qu'on ne fait PAS

- **Modifier `client/src/agentverse/`.** Mis de côté. On change son hôte (§5.1), jamais son code.
- **Un second système d'onglets pour les chats.** Ils entrent dans celui des fichiers.
- **Réécrire `.editor-tab*`.** Les styles existent et marchent : on les déplace.
- **Ajouter une dépendance** pour les onglets ou le glisser-déposer. Un tableau, un index, et l'API HTML5 native suffisent.
- **Réordonner les onglets par glissement.** Hors périmètre : l'ordre d'ouverture suffit. À rouvrir si le besoin se manifeste.
- **Grouper / diviser l'éditeur** (split view). Hors périmètre.
- **Renommer des composants** en passant. Un déplacement ne se mélange pas à un renommage : ça rend le diff illisible.
- **Refondre le visuel.** Le polish est déjà livré ; cette réorganisation ne le rejoue pas.
- **Corriger `scripts/check-design-debt.sh`** (bug du `grep -h`). Réel, hors sujet, le gate passe.

---

## 10. Vérification — après chaque étape

```bash
cd client && npx stylelint "src/**/*.css"
cd client && npx tsc --noEmit
cd client && CI=true npx react-scripts test --watchAll=false
cd client && npm run build
```

Références actuelles à ne pas dégrader : stylelint **226**, dette hex **229**, build vert, tests **309** (puis 304 après ①).

Aucune opération git : ni `commit`, ni `add`, ni `stash`, ni `checkout`.

**Vérification manuelle obligatoire** en fin d'étapes ② et ⑤, l'automatisation ne couvrant pas la coquille : ouvrir plusieurs fichiers, un aperçu, deux chats, fermer dans un ordre quelconque, redémarrer, vérifier la restauration.

---

## 11. Recette

1. **Un seul** bandeau d'onglets à l'écran, au niveau de la coquille.
2. Les onglets ne contiennent que des documents : fichiers, aperçu, chats, paramètres, AgentVerse.
3. Git / AI Changes / Flux s'ouvrent depuis l'Activity Bar ; Brain et Terminal depuis le Panel.
4. Le chat s'ouvre **à côté** du code, plus à sa place.
5. Plusieurs conversations coexistent : une dans le panneau droit, *n* en onglets, une seule source de vérité par session.
6. Une session s'ouvre en onglet par **bouton** et par **menu contextuel** (glissement optionnel), et rouvrir une session déjà ouverte y **bascule** au lieu de dupliquer.
7. Les Paramètres sont un onglet et exposent MCP.
8. `Ctrl+W`, `Ctrl+Tab`, `Ctrl+1..9` fonctionnent.
9. Une session persistée à l'ancien format (`openFiles: string[]`) se recharge sans erreur ni perte.
10. Fermer le dernier onglet laisse un état vide utilisable, jamais une application bloquée.
11. Build vert, et toute baisse du compte de tests est nommée et justifiée.
