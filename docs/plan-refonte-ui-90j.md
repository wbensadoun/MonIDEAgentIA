# Plan de refonte UI — Code Companion (90 jours)

> Blueprint de dev. Etabli par lecture du code au 2026-08-04, branche `codex/agent-ui-layout`.

---

## 0. Correction du brief — etat reel constate

Le brief de cadrage decrit un etat du code qui n'existe plus. Avant de planifier, il faut
remettre les compteurs a zero, sinon on budgete 90 jours de travail deja fait.

| Affirmation du brief | Mesure reelle | Impact plan |
|---|---|---|
| `main.js` : 7300 lignes | **183 lignes**. Decoupe faite dans `electron/` (11 641 l. / ~40 fichiers, services + ipc + providers) | Le chantier "casser le monolithe main" est **clos** |
| `App.js` : 1900 lignes | **867 lignes**, deja extrait en 18 hooks (`useAI`, `useEditorSession`, `useWorkspaceSessionLayout`…) | Le probleme n'est plus la taille, c'est le **prop-drilling** |
| `useAI.js` : 1900 lignes | **682 lignes**, sous-decoupe en `useAIPendingChanges` (961), `useAIModelSettings` (406)… | Idem |
| "React 18 + Tailwind CSS" | Tailwind = **dependance fantome** (cf. §2.0) | Decision d'architecture requise semaine 1 |

### Les 4 decouvertes qui reecrivent la roadmap

**(A) Une UI de chat refaite, testee et accessible existe deja — et n'est pas branchee.**

```
components/AIChat/ChatInterface.tsx      110 l.  ─┐
components/AIChat/MessageViewer.tsx      147 l.   │ 713 l. de composants TSX
components/AIChat/InputArea.tsx          144 l.   │ propres, typés, decoupes
components/AIChat/AutonomyControls.tsx   233 l.   │
components/AIChat/CodeBlock.tsx           79 l.  ─┘
components/AIChat/__tests__/a11y.test.tsx        368 l. ─┐ 662 l. de tests
components/AIChat/__tests__/ChatInterface.e2e…   294 l. ─┘ a11y + e2e
components/ComponentLibrary/ComponentLibrary.tsx 292 l.  ← showcase/storybook maison
```

La production (`components/AIChat/index.js`, **1907 lignes**, 54 hooks) n'en importe
**qu'une constante** :

```js
// AIChat/index.js:11
import { AUTONOMY_LEVELS, toLegacyPermission } from './AutonomyControls';
```

`ChatInterface`, `MessageViewer`, `InputArea` ne sont importes que par leurs propres tests
et par `ComponentLibrary.tsx`. **La Phase 1 du brief est deja ecrite a ~70 %, sur etagere.**
Le J1 n'est pas "concevoir un design system", c'est **atterrir le travail existant**.

**(B) `styles/tokens.css` (350 l.) est un bon design system — applique a moitie.**

Il couvre deja : 5 themes, echelle typo (minor third, base 13px), grille 8px, radius,
elevation, motion **avec `prefers-reduced-motion`**, echelle z-index, focus ring WCAG.
Mais : **259 couleurs hex distinctes** subsistent en dur dans les 34 fichiers CSS
(15 152 lignes). Le chantier design system est un travail de **migration et
d'enforcement**, pas de creation.

**(C) Le backend Checkpoints est termine ; le frontend l'ignore.**

```
electron/services/snapshot.service.js  → createAISnapshot / listAISnapshots / restoreAISnapshot
electron/ipc/snapshotHandlers.js       → 3 handlers IPC cables
preload.js:83-85                       → 3 methodes exposees
```

Cote client, `listAISnapshots` et `restoreAISnapshot` ne sont **jamais appeles**. Toute
l'exposition UI tient en une ligne de texte gris 9px :

```js
// AIChat/index.js:1463
<div style={{ padding:'3px 14px', fontSize:9, color:'var(--text-muted)' }}>Snapshot: {pendingSnapshotId}</div>
```

**Checkpoints + Rewind = chantier purement frontend sur backend fini.** Meilleur
ratio impact/cout du plan.

**(D) Explorateur et editeur ne sont pas les points faibles annonces.**

- `FileExplorer/index.js` : drag-drop (`onDragStart`/`onDragEnter`/`onDrop`), menu
  contextuel (`onContextMenu`), rename inline (`renameState`/`onRenameCommit`/`onRenameCancel`) — **deja la**.
- `CodeEditor/index.js` : extraction de symboles, panneau outline, symbol picker
  (`utils/editorSymbols.js`, `showOutline`, `activeEditorSymbol`, `cursorLine`) — **deja la**.

Les vrais manques : **aucune virtualisation** (pas de `react-window` dans les deps ;
l'arbre complet est rendu), **pas de breadcrumbs**, **pas de LSP**.

### Reformulation du projet

> Ce n'est pas une refonte greenfield. C'est un **projet d'atterrissage et de
> consolidation** : ~60 % du "nouveau" est deja construit mais deconnecte. Le risque
> principal du plan n'est pas la conception, c'est **la double implementation** — et la
> tentation de re-concevoir ce qui attend deja d'etre branche.

---

## 1. Diagnostic de la hierarchie visuelle

### 1.1 Le flow principal

Un seul parcours represente >80 % de l'usage reel :

```
  Ouvrir projet → decrire l'intention → LIRE LE DIFF PROPOSE → accepter/rejeter → verifier
                                         ▲                      ▲
                                    LE MOMENT CRITIQUE     LE MOMENT DE CONFIANCE
```

**Tout le reste est du support.** Le test de chaque decision UI : est-ce que ca rend le
diff plus lisible et la decision accept/reject plus sure ? Sinon, ca recule d'un plan.

### 1.2 Conflits cognitifs identifies

**C1 — Trois axes de "mode" concurrents, non orthogonaux, affiches ensemble.**

L'utilisateur doit tenir trois selecteurs en tete simultanement :

| Axe | Valeurs | Source |
|---|---|---|
| `executionMode` | Ask / Plan / Agent | `utils/agentModes.js` |
| `permissionMode` / autonomie | read_only / edit / edit_terminal | `AutonomyControls` |
| `viewMode` | ide / chat / agents | `useAppUiState` |

Ils sont partiellement redondants (`Ask` implique deja `readOnly` — cf. `getModePolicy`),
mais presentes comme independants. **C'est la premiere source de charge cognitive**,
avant meme la densite. `Ask`+`edit_terminal` est une combinaison affichable et
contradictoire.

**C2 — Prop-drilling qui materialise le desordre a l'ecran.**

```js
// App.js:543-613 — un seul objet
const aiChatProps = { /* ~60 proprietes */ };
```

Le panneau IA recoit 60 props parce qu'il fait 60 choses. La complexite du cockpit est le
**symptome visuel** d'une absence de frontiere de state.

**C3 — Props morts : la topbar a ete videe sans etre re-conçue.**

```js
// AppShell/AppTopbar.js:54-65
  _thinkingMode, _onThinkingModeChange, _deepContextEnabled,
  _onDeepContextEnabledChange, _isLoading, multiAIState: _multiAIState,
  _resolvedOllamaModel, _availableOllamaModels, _recommendedOllamaModel,
  _ollamaTopbarLabel,
```

App.js passe ~30 props ; une dizaine sont prefixees `_` pour taire ESLint. La topbar
compte **1 seul `<button>/<select>`** pour 286 lignes. Les controles ont migre vers le
chat sans nettoyer le contrat. Consequence utilisateur : **la topbar n'a plus de role
lisible** — ni identite, ni contexte, ni action.

**C4 — Trois `viewMode` qui reinventent chacun leur mise en page.**

`WorkspaceLayout` (451 l.), `ChatLayout` (236 l.), `AgentsLayout` divergent. `ChatLayout`
a ses propres etats de collapse (`isChatSidebarCollapsed`, `isSwarmPanelOpen`) remontes
dans `App.js` avec leur propre persistance localStorage, en parallele du systeme de
layout pixel de `useWorkspaceSessionLayout`. **Deux modeles de layout coexistent.**

**C5 — Pas de hierarchie d'accent.** 259 hex en dur, et `--accent`, `--accent-2`,
`--accent-3` utilises sans regle. Quand tout est accentue, le diff en attente — la seule
chose qui merite vraiment l'attention — ne ressort pas.

### 1.3 Verdict

La densite n'est pas la maladie, c'est le **symptome**. La maladie est l'**absence de
hierarchie de decision** : l'UI presente les reglages du systeme au meme niveau visuel que
la decision de l'utilisateur. On corrige en subordonnant la configuration (rare) a la
revue (permanente).

---

## 2. Systeme de design

### 2.0 Decision bloquante — Tailwind : abandonner

**Constat :**

```js
// client/tailwind.config.js  — integralite du theme
theme: { extend: {} },
```
- `index.css` = 3 lignes (`@tailwind base/components/utilities`), rien d'autre.
- Utilitaires Tailwind employes dans **2 fichiers** (`Settings/index.js`, `Settings/McpSettings.js`).
- Face a **15 152 lignes** de CSS ecrit main, dont un `tokens.css` de qualite.
- `@apply` : **0 occurrence**.

**Decision : retirer Tailwind. Doubler sur `tokens.css` + CSS Modules.**

Justification : migrer 15k lignes vers Tailwind est une reecriture a benefice utilisateur
nul, et ferait perdre le theming multi-themes par variables CSS (5 themes) qui fonctionne
deja. Tailwind sans tokens configures ne ferait que **rajouter un 3e vocabulaire de
couleur** aux 2 existants. Garder Tailwind purge et non configure, c'est payer le cout
mental d'une techno sans son benefice.

> Action J1-J3 : desinstaller `tailwindcss`, supprimer `tailwind.config.js`, convertir les
> ~2 fichiers Settings, remplacer `index.css` par l'import de `tokens.css` + un reset.
> **Si l'equipe refuse cet abandon**, l'alternative est de porter `tokens.css` dans
> `theme.extend` et d'interdire tout CSS nouveau — mais alors la Phase 1 double de cout.

### 2.1 Couleurs — durcir l'existant, ne pas re-designer

Les palettes de `tokens.css` sont bonnes (inspiration Radix, 5 themes, `color-scheme`
correct). Le travail n'est pas de les refaire mais d'**imposer une semantique d'accent**,
aujourd'hui absente.

Ajout a `tokens.css` — role, pas teinte :

```css
:root {
  /* Hierarchie d'attention. Une seule regle : au plus UN --attn-critical
     visible a l'ecran a un instant donne. */
  --attn-critical: var(--accent);      /* diff en attente de decision  */
  --attn-active:   var(--accent-soft); /* run en cours, streaming      */
  --attn-info:     var(--text-dim);    /* etat passif, metadonnee      */

  /* Semantique de diff — actuellement en dur dans 4 CSS differents */
  --diff-add-bg:    var(--success-soft);
  --diff-add-fg:    var(--success);
  --diff-del-bg:    var(--danger-soft);
  --diff-del-fg:    var(--danger);
  --diff-gutter:    var(--border);
}
```

**Regle d'or a inscrire en tete de `tokens.css` :** `--accent` est reserve a **l'action
attendue de l'utilisateur**. Un panneau, un onglet, un badge d'etat n'ont **jamais** droit
a `--accent` en aplat.

**Budget de migration :** 259 hex → objectif **< 20** (autorises uniquement dans
`agentverse/` et les canvas Phaser/ReactFlow, hors systeme). Mesurable en CI (§2.6).

### 2.2 Typographie

Deja definie (`--text-xs` 11px → `--text-2xl` 28px, base 13px). Un seul manque : les
**roles** ne sont pas nommes, donc chaque composant rechoisit. Ajouter :

```css
:root {
  --type-code:    var(--text-base)/var(--leading-normal) var(--font-mono);
  --type-body:    var(--text-base)/var(--leading-normal) var(--font-sans);
  --type-ui:      var(--text-sm)/var(--leading-snug)  var(--font-sans);
  --type-meta:    var(--text-xs)/var(--leading-snug)  var(--font-sans);
  --type-panel-h: var(--font-weight-semibold) var(--text-md)/var(--leading-tight) var(--font-sans);
}
```

**Interdiction :** plus aucun `font-size` numerique en dur hors `tokens.css`. Le
`fontSize: 9` de `AIChat/index.js:1463` est hors echelle (min = 11px) et illisible —
symptomatique.

### 2.3 Spacing

`--space-*` existe et est correct (grille 8px, demi-pas 4px). Constat de `tokens.css`
lui-meme : *"App.css alone has 60+ distinct spacing values"*. Le chantier est
l'application. Meme traitement CI que les couleurs.

### 2.4 Composants modulaires

**Ne rien creer avant d'avoir inventorie.** Existent deja :
`ComponentLibrary/{Toolbar,Dialog,icons}` + le set TSX shelve `{AutonomyControls,
MessageViewer, InputArea, CodeBlock, ChatInterface}`.

Socle cible (`components/ui/`), par ordre de dette resorbee :

| Composant | Etat | Action |
|---|---|---|
| `Button` / `IconButton` | `Toolbar.tsx` partiel | Generaliser, 3 variants (`primary`/`ghost`/`danger`), 2 tailles |
| `Panel` | duplique ~6× | Extraire : header + actions + body scrollable + empty state |
| `Dialog` | existe | Conserver, brancher focus-trap |
| `Pill` / `Segmented` | duplique (usePillMenu ×2) | Un seul, pilote les 3 axes de mode |
| `Popover` | duplique (`useLayoutMenu` AppTopbar:23 = copie de `usePillMenu`) | Extraire — commentaire du code l'admet deja |
| `EmptyState` | absent | Creer : chaque panneau vide doit dire quoi faire |
| `DiffView` | logique dans `utils/aiDiff.js` | Composant unique reutilise par AIChangesPanel + GitPanel + chat |

### 2.5 Etats — le trou le plus couteux

`tokens.css` documente que `App.css` fait `outline: none` a **3 endroits au moins** sans
remplacement (echec WCAG 2.4.7). Le token `.focus-ring` existe mais n'est pas applique.

Matrice obligatoire pour tout composant de `components/ui/` :

```
            default   hover        active       focus-visible   disabled     loading
Button      surface   surface-2    surface-2    + focus-ring    opacity .5   spinner, aria-busy
                                   translateY0                  cursor:na    largeur figee
IconButton  text-dim  text-main    accent       + focus-ring    opacity .4   —
Pill/Seg    text-dim  surface-2    accent-soft  + focus-ring    masque       —
Panel row   —         surface-2    accent-soft  + focus-ring    —            skeleton
```

Deux regles non negociables :
1. **Aucun `outline: none` sans `:focus-visible` compensatoire.** Bloquant en CI.
2. **Le loading ne doit jamais changer la largeur** d'un bouton (evite le layout shift
   pendant les runs, tres frequents ici).

### 2.6 Enforcement — sans CI, rien ne tient

Le vrai risque : `tokens.css` existe depuis un moment et l'adoption est a moitie faite.
Sans garde-fou automatique, la Phase 1 se re-degradera.

```json
// .stylelintrc — a ajouter en Phase 1, bloquant en CI
{
  "rules": {
    "declaration-property-value-disallowed-list": {
      "/^(color|background|border-color|fill)/": ["/^#/", "/^rgb/"]
    },
    "declaration-no-important": true,
    "unit-disallowed-list": []
  },
  "ignoreFiles": ["src/agentverse/**", "src/styles/tokens.css"]
}
```

Plus un budget regressif applique en CI (echoue si le compteur augmente) :

```bash
# scripts/check-design-debt.sh
HEX=$(grep -rhoE "#[0-9a-fA-F]{3,8}\b" --include=*.css client/src \
      | grep -v tokens.css | sort -u | wc -l)
echo "hex distincts: $HEX (budget: $BUDGET)"
[ "$HEX" -le "$BUDGET" ] || exit 1
```

Baseline J0 = **259**. Jalons : J30 ≤ 120, J60 ≤ 50, J90 ≤ 20.

---

## 3. Refonte par zone

### 3.1 Top bar — lui redonner un role

Aujourd'hui : 286 lignes, 1 controle, ~10 props morts. Elle ne sert plus a rien mais
occupe la ligne la plus precieuse.

**Role assigne : identite + contexte + etat global.** Aucun reglage de modele (le chat
les possede deja, cf. §3.4).

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│ ◈ code-companion   ⌘K Rechercher…      │ ● 3 modifs en attente │ ⟲ │ ▣ │ ⚙ │
│   └ projet          └ palette (centre)   └ LE signal critique    │   │   │
└──────────────────────────────────────────────────────────────────────────────────┘
    zone gauche          zone centre              zone droite : etat → actions
```

- `⌘K` au centre, toujours visible : c'est le vrai point d'entree, aujourd'hui cache.
- **"N modifs en attente"** promu en topbar, seul element autorise a porter
  `--attn-critical`. Aujourd'hui l'info n'est que dans la StatusBar (`pendingAIChangeCount`).
- `⟲` = Checkpoints (§4.2), `▣` = layout, `⚙` = settings.
- Les toggles de panneaux (5 `IconButton` aujourd'hui) passent dans le popover `▣` :
  ce sont des actions rares, elles n'ont pas leur place en permanence.

```jsx
// components/AppShell/AppTopbar.jsx — contrat cible : 6 props, contre ~30
<Topbar>
  <TopbarIdentity project={projectName} onOpenProject={onOpenFolder} />
  <CommandTrigger onOpen={openCommandPalette} />           {/* ⌘K */}
  <TopbarStatus />        {/* lit pendingStore — aucune prop */}
  <TopbarActions />       {/* lit uiStore     — aucune prop */}
</Topbar>
```

`TopbarStatus`/`TopbarActions` s'abonnent aux stores (§5) : c'est ce qui fait tomber le
contrat de 30 props a 6, et supprime les `_props` morts.

### 3.2 Panneau gauche — virtualiser, pas re-implementer

Drag-drop, menu contextuel et rename inline **existent** (§0-D). Ne pas les refaire.

Manques reels, par ordre de priorite :

1. **Virtualisation** — aucune dep de virtualisation. Un monorepo fait ramer l'arbre.
   → `react-window` sur l'arbre aplati. **C'est le seul vrai gain perf de l'explorateur.**
2. **Selection multiple** (`Shift`/`Ctrl`+clic) — absente ; requise pour les operations de masse.
3. **Etat git par ligne** — `GitPanel` connait le statut, l'explorateur ne l'affiche pas.
   Pastille M/A/D en fin de ligne.
4. **Filtre inline** — `activeSidebarSection` a deja un slot `search`, non exploite.

```jsx
// FileExplorer : arbre aplati + fenetre. Les handlers existants sont conserves tels quels.
const rows = useMemo(
  () => flattenTree(projectItems, expandedFolders),   // -> [{path, depth, kind, gitStatus}]
  [projectItems, expandedFolders]
);

<FixedSizeList height={h} itemCount={rows.length} itemSize={22} width="100%">
  {({ index, style }) => (
    <FileRow
      style={style}
      row={rows[index]}
      onContextMenu={onOpenContextMenu}   /* existant */
      onDragStart={onDragStart}           /* existant */
      renameState={renameState}           /* existant */
    />
  )}
</FixedSizeList>
```

> `itemSize` fixe (22px) impose que toutes les lignes aient la meme hauteur — a verifier
> contre `FileExplorer.css` avant implementation.

### 3.3 Panneau central — breadcrumbs et rien d'autre

`CodeEditor` a deja outline + symbol picker. Manque unique et reel : **les breadcrumbs**,
d'autant plus faciles que `activeEditorSymbol` et `cursorLine` sont **deja calcules**.

```
┌───────────────────────────────────────────────────────────┐
│ ▸ index.js  ✕ │ ▸ useAI.js •✕ │                    ⊞ ⋯ │  ← onglets
├───────────────────────────────────────────────────────────┤
│ src › hooks › useAI.js › generateAIResponse()             │  ← breadcrumb (NOUVEAU)
├───────────────────────────────────────────────────────────┤
```

```jsx
// Cout reel : ~40 lignes. Les donnees existent deja.
<Breadcrumb>
  {splitPath(activeFile).map(seg => <Crumb key={seg.path} {...seg} />)}
  {activeEditorSymbol && (
    <Crumb icon={getEditorSymbolKindIcon(activeEditorSymbol.kind)}
           onClick={() => setShowSymbolPicker(true)}>
      {activeEditorSymbol.name}
    </Crumb>
  )}
</Breadcrumb>
```

**LSP : hors perimetre 90 jours.** C'est un projet backend (serveurs de langage, cycle de
vie, protocole) sans rapport avec une refonte UI. L'inscrire ici ferait derailler le plan.

### 3.4 Panneau droit — le vrai chantier

1907 lignes, 54 hooks, ~60 props. **Mais la version refaite existe** (§0-A). Le plan est
un **branchement**, pas une reecriture.

**Resolution du conflit C1 — deux axes au lieu de trois.**

`getModePolicy()` derive **deja** `readOnly` et `canUseTerminal` depuis le mode. La
permission n'a donc pas a etre un selecteur independant : elle est une **consequence**.

```
AVANT (3 selecteurs orthogonaux, combinaisons absurdes possibles)
  [Ask|Plan|Agent]  ×  [read_only|edit|edit_terminal]  ×  [ide|chat|agents]

APRES (1 selecteur d'intention + 1 exception explicite)
  ┌─────────────────────────────────────────────────────┐
  │  ○ Ask      Lire et expliquer                        │
  │  ◉ Plan     Proposer un plan validable               │
  │  ○ Agent    Modifier avec revue de diff              │
  └─────────────────────────────────────────────────────┘
     └ la permission DECOULE du mode (getModePolicy)
     └ "Autoriser le terminal" = case a cocher, visible en mode Agent uniquement
```

```jsx
// AutonomyControls devient derive, non concurrent
const policy = getModePolicy(executionMode);          // existant, utils/agentModes.js
<ModeSelector value={executionMode} onChange={setExecutionMode} />
{policy.canProposeFiles && (
  <Checkbox checked={terminalAllowed} onChange={setTerminalAllowed}
            label="Autoriser les commandes terminal" />
)}
```

**Layout cible — la revue de diff prend le dessus :**

```
┌──────────────────────────────────┐
│ Conversation ▾            + ⟲ ⋯ │  ← 1 ligne (vs 3 aujourd'hui)
├──────────────────────────────────┤
│                                  │
│   messages (virtualises)         │  ← MessageViewer.tsx (existe)
│                                  │
├──────────────────────────────────┤
│ ⚠ 3 fichiers en attente          │  ← promu, --attn-critical
│   ▸ src/App.js        +12 −3     │     collapsible, focus par defaut
│   ▸ src/hooks/useAI.js +4  −0    │
│   [Tout accepter] [Tout rejeter] │
├──────────────────────────────────┤
│ ┌──────────────────────────────┐ │
│ │ Decrivez votre intention…    │ │  ← InputArea.tsx (existe)
│ └──────────────────────────────┘ │
│ [Plan ▾] [claude-opus ▾]    [↑] │  ← AutonomyControls.tsx (existe, simplifie)
└──────────────────────────────────┘
```

### 3.5 Zone basse — unifier

`TerminalPanel` (339 l.) et `InteractiveTerminal` coexistent, et `AIChat/index.js` importe
**son propre** `@xterm/xterm` (ligne 3) : **trois surfaces terminal**. Cible : un seul
composant `BottomDock` a onglets — `Terminal | Sortie | Problemes | Taches` — une seule
instance xterm partagee.

---

## 4. Nouvelles surfaces produit

### 4.1 Plan Mode — rendre le plan editable

Le mode existe (`agentModes.js`) mais sa sortie est du markdown de chat : non editable,
non validable. `decoratePromptForMode` doit imposer un **format structure** parsable.

```
┌────────────────────────────────────────────────────┐
│ 📋 Plan propose                    [Editer] [Lancer]│
├────────────────────────────────────────────────────┤
│ ☑ 1. Extraire les tokens de App.css      ~2 fich.  │
│ ☑ 2. Ajouter stylelint en CI             ~1 fich.  │
│ ☐ 3. Migrer AIChangesPanel               ~4 fich.  │  ← decochable
│      └ src/components/AIChangesPanel/index.js      │
│ ☑ 4. Mettre a jour les tests                       │
├────────────────────────────────────────────────────┤
│ 4 etapes · 3 selectionnees · ~7 fichiers touches   │
└────────────────────────────────────────────────────┘
```

Contrat : le backend emet des etapes en JSON ; chaque etape decochee est retiree du prompt
d'execution. **C'est ce qui transforme "Plan" d'un affichage en un point de controle.**

### 4.2 Checkpoints — quick win maximal

Backend fini (§0-C). Frontend = un panneau + deux appels IPC deja exposes.

```
┌────────────────────────────────────────────────────┐
│ ⟲ Historique                                  ✕   │
├────────────────────────────────────────────────────┤
│ ● maintenant       3 modifs en attente             │
│ │                                                  │
│ ○ il y a 5 min     "ajouter les breadcrumbs"       │
│ │                  7 fichiers        [Revenir ici] │
│ ○ il y a 22 min    "refonte topbar"                │
│ │                  3 fichiers        [Revenir ici] │
└────────────────────────────────────────────────────┘
```

```jsx
// hooks/useCheckpoints.js — l'API preload existe deja
const list    = () => window.electronAPI.listAISnapshots(projectPath);
const restore = (id) => window.electronAPI.restoreAISnapshot(projectPath, id);
// Garde-fou : creer un snapshot AVANT de restaurer, sinon le rewind est destructif.
```

> **Risque a traiter des le design :** `restoreAISnapshot` ecrase le disque. Un rewind
> doit toujours etre precede d'un snapshot implicite, et confirme par un dialog listant
> les fichiers impactes. Sans cela, le bouton "Revenir ici" est un piege a perte de donnees.

### 4.3 Task List

`useAgentRuns` + `agentRuns` existent deja et alimentent `AIChangesPanel`. La Task List
est une **seconde vue** sur ces donnees (liste plate, tous projets), pas une source neuve.
"Cloud" reste un onglet vide tant qu'aucun backend cloud n'existe — ne pas construire une
UI pour une capacite absente.

### 4.4 Extension Manager

`mcp-server/`, `mcpClientManager.js`, `McpSettings.js` (504 l.) et `skill.service.js`
existent. Le besoin n'est pas un nouveau systeme mais **une seule surface** unifiant MCP +
Skills + Agents + Workflows, aujourd'hui repartis entre `Settings`, `WorkflowManager` et
`AgentsLayout`. **Phase 3 — a ne lancer que si les phases 1-2 sont soldees.**

---

## 5. Architecture React

### 5.1 State : Zustand est deja choisi — et inutilise

```
stores/{project,ai,editor,pending,settings,agent,ui}Store.js   306 l. au total
```
**Consommation reelle :**
- `projectStore` : lu pour **un seul champ** (`currentProjectPath`), dans 2 fichiers.
- `uiStore` : **ecrit sans jamais etre lu**. `useAppUiState.js:103-107` y pousse 5 champs
  via `useEffect`, aucun composant ne s'y abonne. C'est un miroir en ecriture seule —
  du cout sans benefice, et un piege : l'etat y est *deja* centralise, mais l'UI continue
  de le recevoir par props.
- Les **5 autres stores** (`ai`, `editor`, `pending`, `settings`, `agent`) : **code mort**.

La question "Redux ou Zustand ?" est tranchee depuis longtemps ; elle n'a simplement
jamais ete executee. **1.6 consiste a finir un branchement, pas a choisir une techno.**

Frontieres cibles :

| Store | Possede | Supprime |
|---|---|---|
| `projectStore` | chemin, arbre, dossiers ouverts | drilling explorateur |
| `editorStore` | onglets, fichier actif, dirty, diff | ~15 props de `editorProps` |
| `aiStore` | historique, streaming, mode, modele | ~25 props de `aiChatProps` |
| `pendingStore` | changements en attente, snapshot | ~10 props (chat **et** AIChangesPanel) |
| `uiStore` | viewMode, collapse, terminal, focus | `_props` morts de la topbar |
| `settingsStore` | provider, permissions, themes | drilling transverse |

**Regle de migration (essentielle pour eviter le big-bang) :** un store a la fois ; le hook
existant devient un adaptateur mince au-dessus du store, pour que les composants non
migres continuent de fonctionner. `useAI.js` reste l'entree, mais lit/ecrit `aiStore`.

**Cible mesurable :** `aiChatProps` de **~60 props → ≤ 8**.

### 5.2 Decomposition

Ordre impose par le risque, pas par la taille :

1. `AIChat/index.js` (1907) → **brancher le TSX existant** (§0-A). Pas une reecriture.
2. `useAIPendingChanges.js` (961) → separer transport IPC / machine a etats / vue.
3. `VisualWorkflowEditor` (1392) et `Settings` (907) → **laisser tels quels**. Rarement
   ouverts, sans impact sur le flow principal. Les toucher serait du gold-plating.

### 5.3 Routing

**Aucun routeur.** `viewMode` (3 valeurs) suffit ; c'est une app desktop mono-fenetre.
Ajouter React Router ici ajouterait une abstraction sans besoin. **Decision : ne pas
router.**

### 5.4 Performance

| Levier | Cible | Justification |
|---|---|---|
| Virtualisation liste | Explorateur, messages, agentRuns | Les 3 seules listes non bornees |
| `React.lazy` | Settings, WorkflowManager, VisualWorkflowEditor, AgentVerse/Phaser | `phaser` + `reactflow` + `monaco` dominent le bundle ; `lazyAgentVerse.js` amorce deja le pattern |
| Selecteurs Zustand | par champ, jamais par objet | evite de re-rendre tout le chat a chaque token streame |
| Streaming | batcher les tokens (~60 fps) | 54 hooks dans AIChat re-evalues a chaque chunk |

---

## 6. Roadmap 90 jours

Sequencement fonde sur les dependances reelles, pas sur les zones.

### Phase 1 — J0-J30 : atterrir et durcir

> Objectif : zero fonctionnalite nouvelle. On branche ce qui existe et on pose les
> garde-fous. **Toute nouveaute en phase 1 est un echec de discipline.**

| # | Tache | Dep. | Sortie verifiable |
|---|---|---|---|
| 1.1 | Trancher Tailwind (§2.0), nettoyer `index.css` | — | `tailwindcss` hors deps |
| 1.2 | stylelint + `check-design-debt.sh` bloquants | 1.1 | CI rouge si hex ↑ |
| 1.3 | Roles d'accent + tokens de diff | 1.2 | tokens.css §1bis |
| 1.4 | **Brancher `ChatInterface.tsx` en production** | 1.3 | `AIChat/index.js` < 600 l. |
| 1.5 | Fusionner mode + permission (C1) | 1.4 | 2 axes au lieu de 3 |
| 1.6 | `aiStore` + `pendingStore` reels | 1.4 | `aiChatProps` ≤ 8 |
| 1.7 | Topbar reconstruite, `_props` morts supprimes | 1.6 | 6 props, 0 `_` |
| 1.8 | Audit focus-visible, supprimer les `outline:none` | 1.2 | jest-axe passe (deja installe) |

**Point de decision J30 :** si 1.4 n'est pas en production, **tout decaler d'un mois**.
Toute la suite depend d'un panneau chat sain.

### Phase 2 — J30-J60 : les surfaces de confiance

| # | Tache | Dep. | Sortie verifiable |
|---|---|---|---|
| 2.1 | **Checkpoints + Rewind** (§4.2) | 1.6 | timeline + restore + garde-fou |
| 2.2 | Plan Mode structure et editable | 1.5 | etapes decochables → prompt |
| 2.3 | Virtualisation explorateur | 1.7 | 10k fichiers fluides |
| 2.4 | Breadcrumbs editeur | 1.7 | ~40 lignes |
| 2.5 | `BottomDock` unifie (§3.5) | 1.7 | 1 instance xterm |
| 2.6 | Task List (vue sur `useAgentRuns`) | 2.1 | liste plate, filtres |

**2.1 avant 2.2** : le rewind est le filet de securite qui rend l'execution d'un plan
acceptable. Livrer Plan Mode sans rewind, c'est augmenter l'exposition sans le recours.

### Phase 3 — J60-J90 : consolidation

| # | Tache | Dep. |
|---|---|---|
| 3.1 | Extension Manager unifie (MCP + Skills + Agents + Workflows) | 2.6 |
| 3.2 | Selection multiple + statut git dans l'explorateur | 2.3 |
| 3.3 | Code splitting (Phaser, ReactFlow, Monaco) | 1.4 |
| 3.4 | Budget dette design ≤ 20 hex | 1.2 |
| 3.5 | Passe a11y complete (navigation clavier de bout en bout) | 1.8 |

**Explicitement hors perimetre :** LSP, backend cloud, refonte de VisualWorkflowEditor,
migration TypeScript integrale.

### Graphe de dependances

```
1.1 → 1.2 → 1.3 ┐
                ├→ 1.4 ─┬→ 1.5 → 2.2 ──────┐
                        ├→ 1.6 → 1.7 ─┬→ 2.3 → 3.2
                        │             ├→ 2.4
                        │             └→ 2.5
                        └→ 2.1 → 2.6 → 3.1
      1.2 → 1.8 → 3.5              1.4 → 3.3
```

**Chemin critique : 1.1 → 1.2 → 1.3 → 1.4 → 1.6 → 1.7 → 2.3 → 3.2.** `1.4` est le
goulot : tout en depend.

---

## 7. Metriques de succes

Mesurables sur le code ou instrumentables — pas de score declaratif seul.

### Sante du code (automatique, en CI, des J0)

| Metrique | J0 | J30 | J60 | J90 |
|---|---|---|---|---|
| Hex distincts hors tokens | 259 | ≤120 | ≤50 | ≤20 |
| `aiChatProps` (nb props) | ~60 | ≤8 | ≤8 | ≤8 |
| `AIChat/index.js` (lignes) | 1907 | <600 | <400 | <400 |
| Props morts `_*` | ~10 | 0 | 0 | 0 |
| `outline:none` sans focus-visible | ≥3 | 0 | 0 | 0 |
| Violations jest-axe | a mesurer | −50 % | −80 % | 0 |
| Composants TSX orphelins | 5 | 0 | 0 | 0 |

### Efficacite (a instrumenter en 1.6 via `uiStore`)

| Parcours | Mesure | Baseline | Cible |
|---|---|---|---|
| Prompt → diff decide | clics | a mesurer J0 | −40 % |
| Annuler une action IA | clics | **impossible** (pas d'UI rewind) | ≤2 |
| Changer de mode | clics | 2 selecteurs | 1 |
| Ouvrir un fichier connu | clics | explorateur | ⌘K, ≤2 |

> **Instrumenter avant de refondre.** Sans baseline J0, les cibles "−40 %" sont
> invendables. Un compteur d'evenements local (aucune telemetrie sortante — app desktop,
> respect de la vie privee) suffit.

### Erreur utilisateur

- **Acceptations regrettees** = accept suivi d'un rewind/undo < 60 s. Impossible a mesurer
  avant 2.1 : cette metrique demarre a J60.
- **Combinaisons de modes impossibles** : 6 combinaisons contradictoires aujourd'hui
  atteignables (Ask × edit_terminal, etc.) → **0** apres 1.5. Verifiable par test unitaire.

### Charge cognitive

- Elements interactifs visibles au repos, ecran par defaut : compte J0 → cible **−30 %**.
- SUS ou NASA-TLX sur 5 utilisateurs a J0 / J45 / J90. Utile en tendance, pas en absolu.
- Temps de premier diff accepte, nouvel utilisateur (`OnboardingModal` existe deja).

---

## 8. Risques et mitigations

| # | Risque | Prob. | Impact | Mitigation |
|---|---|---|---|---|
| R1 | **Double implementation** — refaire le chat en ignorant le TSX shelve | **Haute** | Critique | 1.4 en tete de chemin critique. Avant toute UI nouvelle : `grep` obligatoire dans `ComponentLibrary` et `*.tsx` |
| R2 | Le TSX shelve est incomplet et a ete abandonne pour une bonne raison | Moyenne | Eleve | **Spike de 2 jours en J1** : monter `ChatInterface` derriere un flag et lister les manques. Si >60 % du perimetre manque, replanifier 1.4 en reecriture |
| R3 | Rewind destructif → perte de travail | Moyenne | **Critique** | Snapshot implicite avant restore + dialog listant les fichiers. Non negociable (§4.2) |
| R4 | Migration Zustand big-bang casse tout | Moyenne | Eleve | Un store a la fois ; les hooks deviennent des adaptateurs ; les composants non migres continuent de marcher |
| R5 | Regression de theme (5 themes × chaque composant) | **Haute** | Moyen | Rendre `ComponentLibrary.tsx` accessible en dev, boucler les 5 themes ; captures de reference |
| R6 | La refonte du chat casse le parsing du streaming | Moyenne | Eleve | Les regex (`FILE_BLOCK_STREAM_REGEX`, `<think>`…) sont de la **logique metier** : les extraire dans `utils/streamParsing.js` **avec tests** avant de toucher au rendu |
| R7 | Le budget dette design bloque des livraisons urgentes | Moyenne | Faible | Budget regressif (jamais monter), pas seuil absolu ; `// stylelint-disable` avec justification autorise |
| R8 | Le perimetre derape sur LSP / cloud | **Haute** | Eleve | Hors-perimetre ecrit noir sur blanc (§6). Toute demande LSP → backlog, pas 90 jours |
| R9 | Les branches en cours entrent en conflit | Moyenne | Moyen | 20 fichiers modifies non commites sur `codex/agent-ui-layout` a J0 : **solder avant 1.1** |

### Le risque dominant

**R1.** Ce plan a une chance serieuse d'echouer non par difficulte technique, mais parce
qu'une equipe lisant le brief d'origine ("App.js 1900 lignes, cockpit complexe") va
**reconstruire ce qui est deja construit**. Le premier livrable n'est pas du code : c'est
la reconnaissance partagee que `ChatInterface.tsx`, `snapshot.service.js`, `agentModes.js`
et `tokens.css` sont **deja la** et attendent d'etre branches.

---

## Annexe — commandes de verification

```bash
# Dette couleur (baseline 259)
grep -rhoE "#[0-9a-fA-F]{3,8}\b" --include=*.css client/src | grep -v tokens.css | sort -u | wc -l

# TSX orphelins : doit tomber a 0 apres 1.4
grep -rn "ChatInterface\|MessageViewer\|InputArea" --include=*.js client/src | grep import

# Props morts de la topbar : doit tomber a 0 apres 1.7
grep -cE "^\s+_[a-zA-Z]" client/src/components/AppShell/AppTopbar.js

# Adoption Zustand : doit couvrir 6 stores apres 1.6
grep -rn "use[A-Z][a-zA-Z]*Store" --include=*.js client/src | grep -v "^client/src/stores/" | wc -l

# API checkpoint jamais appelee : doit devenir non vide apres 2.1
grep -rn "listAISnapshots\|restoreAISnapshot" --include=*.js client/src
```
