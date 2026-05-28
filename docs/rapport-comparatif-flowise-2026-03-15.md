# Comparatif Workflow Visuel vs FlowiseAI

Date: 15 mars 2026  
Version: 2.0 — enrichie avec recommandations P0-P5 et analyse du code réel

---

## Périmètre

Comparaison entre :

- la fonctionnalité de workflow visuel actuelle de **Mon IDE Agent IA**
- **FlowiseAI**, outil spécialisé dans la construction de flows IA et agentiques

Sources utilisées :

- code local : `client/src/components/VisualWorkflowEditor/index.js`
- code local : `client/src/hooks/useWorkflowRunner.js`
- code local : `client/src/utils/workflowRuntime.js`
- code local : `client/src/hooks/useAI.js`
- code local : `electron/ipc/workflowHandlers.js`
- code local : `electron/workflows/visualWorkflowSchema.js`
- Flowise docs : <https://docs.flowiseai.com/using-flowise/agentflowv2>
- Flowise docs : <https://docs.flowiseai.com/using-flowise/variables>
- Flowise docs : <https://docs.flowiseai.com/integrations/langchain/document-loaders/github>
- Flowise docs : <https://docs.flowiseai.com/integrations/langchain/document-loaders>
- Flowise docs : <https://docs.flowiseai.com/using-flowise/analytics>
- Flowise docs : <https://docs.flowiseai.com/using-flowise/evaluations>
- Flowise docs : <https://docs.flowiseai.com/using-flowise/prediction>
- Flowise docs : <https://docs.flowiseai.com/using-flowise/workspaces>
- Flowise docs : <https://docs.flowiseai.com/using-flowise/monitoring>
- Flowise docs : <https://docs.flowiseai.com/configuration/running-in-production>

---

## Synthèse exécutive

FlowiseAI est aujourd'hui nettement plus mature que Mon IDE Agent IA sur la fonction "workflow IA visuel" elle-même.

Il est plus fort sur :

- le modèle d'exécution
- la richesse des nœuds
- la gestion de l'état
- les intégrations documentaires et RAG
- l'observabilité
- la mise en production
- la multi-équipe

En revanche, Mon IDE Agent IA garde un avantage structurel sur un autre terrain :

- orchestration locale orientée code
- intégration native avec éditeur, terminal, git, preview, pending changes
- workflow visuel au service d'un IDE desktop AI-native
- multi-providers IA (Gemini, Kimi K2.5, Ollama, Claude, Multi-IA 5 agents)
- génération IA de workflow avec animation progressive dans le canvas

Conclusion :

- si l'objectif est de devenir une "plateforme de flows IA généraliste", Flowise est loin devant
- si l'objectif est de faire le meilleur IDE desktop AI-native orienté production/transformation/orchestration de code, votre direction reste pertinente
- il faut donc rattraper Flowise sur les fondamentaux d'orchestration, sans copier son positionnement produit

---

## Positionnement

Flowise est pensé comme une plateforme visuelle spécialisée dans les chatflows, agentflows, intégrations LLM, outils, documents, observabilité et exposition par API.

Votre produit est mieux positionné comme :

- un IDE desktop AI-native
- spécialisé dans la production, la transformation et l'orchestration de code
- avec workflow visuel et exécution locale

Le bon objectif n'est donc pas "faire Flowise dans l'IDE".

Le bon objectif est plutôt :

- atteindre un niveau de rigueur d'orchestration proche de Flowise
- tout en restant focalisé sur le travail de développement local

---

## Comparaison détaillée

### 1. Modèle d'exécution

#### Flowise

D'après la doc Agentflow V2, Flowise a un vrai moteur d'orchestration :

- nœuds spécialisés nativement
- exécution basée sur un système de dépendances et de file d'exécution
- branchements conditionnels
- boucles
- human-in-the-loop
- flow state explicite

La doc est claire : les connexions visuelles définissent explicitement le chemin d'exécution et l'état du flow est un mécanisme de partage de données à travers le workflow.

#### Mon IDE Agent IA — état réel du code

L'analyse de `useWorkflowRunner.js` confirme l'implémentation actuelle :

```js
// useWorkflowRunner.js — topoSort
const topoSort = useCallback((nodes, edges) => {
    const adj = {};
    const inDegree = {};
    nodes.forEach(n => { adj[n.id] = []; inDegree[n.id] = 0; });
    edges.forEach(e => {
        if (adj[e.source]) adj[e.source].push(e.target);
        if (inDegree[e.target] !== undefined) inDegree[e.target]++;
    });
    const queue = nodes.filter(n => inDegree[n.id] === 0).map(n => n.id);
    const sorted = [];
    while (queue.length > 0) {
        const id = queue.shift();
        sorted.push(id);
        (adj[id] || []).forEach(next => {
            inDegree[next]--;
            if (inDegree[next] === 0) queue.push(next);
        });
    }
    // Ajouter les nœuds orphelins
    nodes.forEach(n => { if (!sorted.includes(n.id)) sorted.push(n.id); });
    return sorted;
}, []);
```

Le tri topologique est correct. Mais l'exécution qui suit est strictement linéaire :

```js
for (const nodeId of sorted) {
    if (abortRef.current) { break; }
    const node = nodes.find(n => n.id === nodeId);
    const result = await executeNode(node, prevResult, results);
    results[nodeId] = result;
    prevResult = result;
}
```

Points manquants confirmés par le code :

- le nœud `logic` évalue une condition (`evaluateWorkflowCondition`) mais le résultat ne pilote pas le graphe — il devient juste une valeur string dans `results`
- pas de branchement réel : les deux branches d'un `if/else` sont toujours exécutées
- pas de boucle réelle : le nœud `Boucle` dans le catalogue n'a aucun comportement distinct dans `executeNode`
- pas d'état de flow structuré : seul `prevResult` (string) et `results` (map nodeId → string) existent
- les nœuds orphelins sont ajoutés à la fin du tri, ce qui peut créer des exécutions non désirées

Conclusion :

- Flowise a un vrai moteur de workflow
- vous avez aujourd'hui surtout un exécuteur linéaire sur graphe dessiné

Niveau :

- Flowise : très au-dessus

---

### 2. Richesse fonctionnelle des nœuds

#### Flowise

Flowise expose un catalogue très large :

- LLMs
- agents
- retrievers
- tools
- HTTP
- document loaders
- vector stores
- memory
- document stores
- custom nodes

Les docs Document Loaders montrent un éventail très large de sources : PDF, CSV, Notion, Confluence, GitHub, Google Drive, API, folder, file, web scrapers, etc.

Le loader GitHub va loin :

- repos publics et privés
- récursivité
- filtrage par glob
- contrôle de concurrence
- retries
- instances GitHub enterprise
- metadata
- text splitter

#### Mon IDE Agent IA — état réel du code

Le catalogue dans `VisualWorkflowEditor/index.js` affiche 16 nœuds répartis en 5 catégories.

Mais l'analyse de `executeNode` dans `useWorkflowRunner.js` révèle la réalité :

```js
case 'action': {
    const command = interpolate(data.command, prevResult, allResults);
    // → exécute une commande shell unique via IPC
    // Lire Fichier, Écrire Fichier, Requête HTTP, Git Commit
    // → tous partagent le même champ `command`
}

case 'trigger': {
    return `Déclencheur "${data.label}" activé`;
    // → Cron et Webhook ne font rien de plus
}

case 'logic': {
    const evaluated = evaluateWorkflowCondition(condition, context);
    return String(evaluated); // → résultat ignoré par le graphe
}
```

Points confirmés :

- `Lire Fichier`, `Écrire Fichier`, `Requête HTTP`, `Git Commit` partagent tous le même champ `command` et le même handler shell
- `Cron / Planifié` et `Webhook` existent dans l'UI mais ne font qu'un message de démarrage
- `Boucle` existe dans le catalogue mais n'a aucun comportement distinct dans le runtime
- `Délai` existe dans le catalogue mais n'est pas géré dans `executeNode`

Points positifs réels :

- le nœud `ai` supporte Gemini, Kimi K2.5 et Ollama via `buildWorkflowAIInvocation`
- le nœud `action` exécute de vraies commandes shell avec timeout 30s et streaming output
- le nœud `logic` a un vrai évaluateur d'expressions (`evaluateWorkflowCondition`) avec support `&&`, `||`, `!`, comparateurs

Conclusion :

- Flowise a des nœuds spécialisés avec comportements distincts
- votre éditeur affiche des types de nœuds plus riches qu'ils ne le sont réellement

Niveau :

- Flowise : très au-dessus

---

### 3. Variables, état et passage de données

#### Flowise

Flowise a :

- variables statiques
- variables runtime via environnement et API
- `Flow State`
- références explicites de type `{{ $flow.state.key }}`
- override via API

La doc explique clairement comment initialiser, mettre à jour et lire l'état.

#### Mon IDE Agent IA — état réel du code

Le système d'interpolation dans `useWorkflowRunner.js` :

```js
const interpolate = useCallback((text, prevResult, allResults) => {
    if (!text) return text;
    let result = text;
    result = result.replace(/\{\{prev\}\}/g, prevResult || '');
    result = result.replace(/\{\{(\w+)\}\}/g, (_, key) => allResults[key] || '');
    return result;
}, []);
```

Ce qui existe :

- `{{prev}}` : résultat du nœud précédent (string)
- `{{nodeId}}` : résultat d'un nœud spécifique par son ID

Ce qui manque :

- pas de schéma d'état
- pas de namespace clair (`flow.state.xxx`)
- pas de variables globales de workflow définissables avant l'exécution
- pas d'override runtime structuré
- pas de vrai data mapping entrée/sortie par nœud (tout est string)
- pas d'inspecteur des variables pendant l'exécution

Conclusion :

- Flowise fournit un système d'état utilisable à grande échelle
- votre système est suffisant pour des démos courtes, pas pour des flows complexes

Niveau :

- Flowise : largement au-dessus

---

### 4. UI du canvas et expérience d'édition

#### Ce que vous faites bien

Votre canvas a déjà de vraies qualités :

- look distinctif et cohérent avec le produit
- animations d'injection IA bien pensées (`animateWorkflowIntoCanvas` avec phases progressives)
- nodes lisibles
- mini-map et controls React Flow
- brouillon local automatique (localStorage par projet)
- import/export JSON
- import catalogue n8n (avec adaptation de format)
- génération IA de workflow (prompt → JSON → canvas animé)
- sauvegarde/chargement de workflows par projet (`.vibe-workflows/`)
- schéma de validation côté Electron (`visualWorkflowSchema.js`) avec migration automatique

C'est une bonne UX de prototype avancé. Elle est visuellement plus personnalisée que beaucoup d'outils React Flow basiques.

#### Ce que Flowise fait mieux

Flowise est plus spécialisé dans l'édition de flow :

- beaucoup plus de types de nœuds réellement configurables
- UI orientée configuration profonde de chaque nœud
- credentials et paramètres liés aux intégrations
- état, outputs, outils, knowledge, memory, API
- logique de production plus visible

Votre UI reste encore en dessous sur plusieurs points :

- pas de panneau de configuration riche par nœud (un seul champ générique `command` pour les actions)
- pas de typage fort des ports (source/target uniques, pas de ports nommés)
- pas d'indication explicite des entrées/sorties de données
- pas de validation métier du graphe avant exécution
- peu de feedback structuré sur les erreurs de configuration
- peu de distinction entre design time et run time

Conclusion :

- sur le style visuel, vous êtes crédibles
- sur l'ergonomie d'un vrai builder spécialisé, Flowise est devant

Niveau :

- Flowise : au-dessus
- vous : bon potentiel sur l'identité visuelle

---

### 5. Debug, tracing, observabilité

#### Flowise

Les docs indiquent :

- step-by-step tracing pour Agentflow V2
- intégrations analytics avec LunaryAI, LangSmith, Langfuse, LangWatch, Arize, Phoenix, Opik
- monitoring Prometheus/Grafana/OpenTelemetry
- évaluations avec datasets et evaluators

C'est un niveau quasi plateforme.

#### Mon IDE Agent IA — état réel du code

Ce qui existe dans `useWorkflowRunner.js` :

```js
const log = useCallback((nodeId, type, message) => {
    const entry = {
        nodeId,
        type, // 'info' | 'success' | 'error' | 'output'
        message,
        timestamp: new Date().toLocaleTimeString('fr-FR'),
    };
    setExecutionLog(prev => [...prev, entry]);
}, []);
```

- log d'exécution local avec timestamp
- highlight du nœud courant (`activeNodeId`)
- résultat par nœud (`nodeResults` avec status success/error)
- streaming output des commandes shell en temps réel

Ce qui manque :

- traces rejouables
- timing par nœud (durée d'exécution)
- comparaison de runs
- score d'évaluation
- métriques globales
- analyse offline
- export JSON des runs

Conclusion :

- Flowise est très loin devant

---

### 6. Partage, collaboration, industrialisation

#### Flowise

Flowise a :

- Prediction API
- streaming
- conversation memory
- upload de fichiers
- variables runtime
- workspaces
- RBAC
- credentials partageables
- recommandations de production et queue mode

#### Mon IDE Agent IA — état réel du code

Ce qui existe dans `workflowHandlers.js` :

- sauvegarde locale projet (`.vibe-workflows/*.json`)
- brouillon localStorage par projet
- exécution locale
- schéma de validation avec migration automatique
- liste, lecture, suppression des workflows

Ce qui manque :

- pas de déploiement natif du workflow comme service
- pas d'API d'exécution dédiée du workflow visuel
- pas de multi-tenant
- pas de RBAC

Conclusion :

- Flowise est beaucoup plus "produit plateforme"
- vous êtes aujourd'hui "outil de composition locale"

---

### 7. RAG, documents et GitHub

#### Flowise

C'est un point de supériorité nette.

Le loader GitHub officiel prend déjà en charge :

- repo URL
- branche
- credentials
- récursivité
- filtres
- retries
- GitHub enterprise
- splitters
- metadata

Le tout s'intègre dans une chaîne Document Loader → Text Splitter → Embeddings → Vector Store → Retrieval.

#### Mon IDE Agent IA

Vous avez du contexte projet, du code local, des fichiers, Ollama et des skills.

Le scan projet dans `useAI.js` est déjà avancé :

```js
const scanPresets = {
    safe: { maxFileSize: 50000, maxFiles: 8000, maxTotalBytes: 25000000 },
    full: { maxFileSize: 120000, maxFiles: 12000, maxTotalBytes: 40000000 },
    god:  { maxFileSize: 250000, maxFiles: 50000, maxTotalBytes: 150000000 }
};
```

Mais dans le workflow visuel lui-même vous n'avez pas encore :

- vrai nœud GitHub loader
- pipeline documentaire structuré
- vector stores
- RAG graph natif
- document store

Conclusion :

- pour l'orchestration documentaire et RAG, Flowise est très loin devant

---

### 8. Génération IA de workflow

#### Votre point fort

Votre génération IA de workflow est différenciante dans un IDE :

- prompt libre
- génération JSON via Gemini
- injection animée dans le canvas (phases progressives avec compteurs nœuds/liens)
- exemples de prompts intégrés (CI/CD, analyse IA, traitement de fichiers)

L'effet produit est bon.

#### Limite actuelle

La génération reste encadrée par un schéma simple :

- peu de types de nœuds
- peu de validation sémantique
- pas de schéma de dataflow réel

Flowise ne mise pas autant sur cette animation de génération, mais sa structure de base supporte des flows beaucoup plus riches une fois construits.

Conclusion :

- vous êtes plus séduisants en "AI-assisted authoring"
- Flowise est plus robuste en "workflow system"

---

## Où vous êtes déjà meilleurs que Flowise

Il faut aussi dire clairement où vous êtes supérieurs, sinon l'analyse serait trompeuse.

### 1. Intégration IDE locale

Votre workflow visuel est branché sur :

- éditeur Monaco
- explorateur de fichiers
- terminal
- Git
- preview web
- modifications IA appliqué/rejet

Flowise n'est pas conçu pour être un IDE code-first.

### 2. Multi-providers IA natifs

Votre système supporte nativement dans le workflow :

- Gemini (via `getGeminiCompletion`)
- Kimi K2.5 (via `getKimiCompletion`)
- Ollama (via `getOllamaCompletion`)

Et dans le chat IA :

- Claude
- Multi-IA 5 agents (Chef de Projet → Frontend Dev → Backend Dev → Architecte → Scrum Master)
- Ollama Multi (3 agents séquentiels)

C'est une richesse que Flowise n'a pas dans cette configuration.

### 3. Expérience développeur locale

Pour automatiser des tâches de dev locales, votre positionnement est très pertinent :

- lancer des commandes
- générer du code
- manipuler des fichiers du projet
- enchaînements reliés à l'état du repo

### 4. Cohésion avec les autres modules IA

Votre produit unifie :

- chat IA
- génération de patchs
- éditeur
- workflows visuels

Flowise est meilleur comme plateforme de flows.
Vous êtes potentiellement meilleurs comme poste de travail IA complet pour développer.

---

## Verdict

### Sur la spécialité "workflow visuel IA"

Flowise gagne clairement.

### Sur la spécialité "workflow visuel pour IDE AI-native local"

Vous avez une vraie carte à jouer.

### Écart actuel

L'écart principal n'est pas seulement en volume de features.
Il est surtout ici :

- Flowise a une sémantique de workflow
- vous avez encore une représentation visuelle d'automations assez linéaires

---

## Recommandations prioritaires

> Les recommandations ci-dessous sont basées sur l'analyse du code réel du projet.  
> Chaque recommandation inclut : le problème identifié dans le code, la solution concrète, et les fichiers à modifier.

---

### P0 — Rendre le workflow réel (moteur d'exécution)

**Priorité : Critique — à faire en premier**

**Problème identifié dans le code :**

Dans `useWorkflowRunner.js`, l'exécution est strictement linéaire malgré le tri topologique :

```js
// Problème : exécution linéaire, le résultat du nœud logic n'influence pas le graphe
for (const nodeId of sorted) {
    const result = await executeNode(node, prevResult, results);
    results[nodeId] = result;
    prevResult = result; // ← toujours le dernier résultat, pas de routage
}
```

Le nœud `logic` évalue une condition mais retourne juste `"true"` ou `"false"` comme string — ce résultat n'est jamais utilisé pour choisir quelle branche exécuter.

**Ce qu'il faut faire :**

#### P0.1 — Exécution par graphe avec routage conditionnel

Remplacer la boucle linéaire par un moteur de graphe qui :

1. démarre depuis les nœuds sans prédécesseurs (triggers)
2. après chaque nœud, consulte les edges sortants
3. pour un nœud `logic`, route vers la branche `true` ou `false` selon le résultat
4. pour un nœud `action`/`ai`, active tous les successeurs

```js
// Architecture cible dans useWorkflowRunner.js
const runWorkflowGraph = async (nodes, edges) => {
    // Construire le graphe de successeurs
    const successors = {}; // nodeId → [{ targetId, edgeLabel }]
    edges.forEach(e => {
        if (!successors[e.source]) successors[e.source] = [];
        successors[e.source].push({ targetId: e.target, label: e.label || 'default' });
    });

    // File d'exécution : commencer par les triggers
    const queue = nodes.filter(n => n.data?.nodeType === 'trigger').map(n => n.id);
    const visited = new Set();
    const results = {};

    while (queue.length > 0) {
        const nodeId = queue.shift();
        if (visited.has(nodeId)) continue;
        visited.add(nodeId);

        const node = nodes.find(n => n.id === nodeId);
        const result = await executeNode(node, results);
        results[nodeId] = result;

        // Routage selon le type de nœud
        const outEdges = successors[nodeId] || [];
        if (node.data?.nodeType === 'logic') {
            // Branchement conditionnel : activer seulement la branche correspondante
            const branch = result.value === true ? 'true' : 'false';
            outEdges
                .filter(e => e.label === branch || e.label === 'default')
                .forEach(e => queue.push(e.targetId));
        } else {
            // Activer tous les successeurs
            outEdges.forEach(e => queue.push(e.targetId));
        }
    }
};
```

**Fichiers à modifier :**

- `client/src/hooks/useWorkflowRunner.js` — remplacer `runWorkflow` par `runWorkflowGraph`
- `client/src/components/VisualWorkflowEditor/index.js` — ajouter `label` sur les edges conditionnels (`true`/`false`)
- `electron/workflows/visualWorkflowSchema.js` — ajouter `label` dans le schéma des edges

#### P0.2 — Vrais nœuds `if/else` avec deux sorties nommées

Le nœud `Condition Si/Sinon` doit avoir deux handles de sortie distincts :

```jsx
// Dans CustomNode, pour nodeType === 'logic'
{nodeType === 'logic' && (
    <>
        <Handle type="source" position={Position.Right} id="true"
                style={{ top: '35%' }} />
        <Handle type="source" position={Position.Right} id="false"
                style={{ top: '65%' }} />
        <div className="vw-node-field">
            <span className="vw-node-label">Condition</span>
            <input className="vw-node-input" ... />
        </div>
        <div className="vw-node-branch-labels">
            <span className="branch-true">✓ Vrai</span>
            <span className="branch-false">✗ Faux</span>
        </div>
    </>
)}
```

#### P0.3 — Nœud `Boucle` avec comportement réel

Actuellement le nœud `Boucle` n'a aucun comportement distinct dans `executeNode`. Il faut :

```js
case 'logic': {
    const subType = data.logicSubType || 'condition'; // 'condition' | 'loop' | 'delay'
    if (subType === 'loop') {
        const iterations = parseInt(data.iterations || '3', 10);
        const loopResults = [];
        for (let i = 0; i < iterations; i++) {
            // Exécuter les nœuds enfants N fois
            loopResults.push(`Itération ${i + 1}: ${prevResult}`);
        }
        return { type: 'loop', iterations, results: loopResults };
    }
    if (subType === 'delay') {
        const seconds = parseFloat(data.delaySeconds || '1');
        await new Promise(r => setTimeout(r, seconds * 1000));
        return `Délai ${seconds}s terminé`;
    }
    // condition par défaut
    const evaluated = evaluateWorkflowCondition(condition, context);
    return { type: 'condition', value: evaluated, raw: String(evaluated) };
}
```

#### P0.4 — État de workflow structuré

Remplacer le passage de `prevResult` (string) par un objet d'état structuré :

```js
// Cible : état de workflow typé
const workflowState = {
    variables: {},          // variables globales définies avant l'exécution
    nodeOutputs: {},        // { nodeId: { value, type, timestamp } }
    currentNodeId: null,
    startedAt: null,
    status: 'idle'          // 'idle' | 'running' | 'paused' | 'completed' | 'error'
};
```

**Impact estimé :** élimine l'écart conceptuel le plus important avec Flowise.

---

### P1 — Spécialiser les nœuds (comportements distincts)

**Priorité : Haute**

**Problème identifié dans le code :**

Dans `VisualWorkflowEditor/index.js`, tous les nœuds `action` partagent un seul champ `command` :

```jsx
{nodeType === 'action' && (
    <div className="vw-node-field">
        <span className="vw-node-label">Commande / Chemin</span>
        <input className="vw-node-input" placeholder="ex: npm test"
               value={data.command || ''} ... />
    </div>
)}
```

Et dans `useWorkflowRunner.js`, tous les `action` exécutent une commande shell :

```js
case 'action': {
    const command = interpolate(data.command, prevResult, allResults);
    // → même handler pour Lire Fichier, Écrire Fichier, HTTP, Git Commit
}
```

**Ce qu'il faut faire :**

#### P1.1 — Nœud `Read File` spécialisé

```js
case 'action': {
    const actionSubType = data.actionSubType || 'shell';

    if (actionSubType === 'read-file') {
        const filePath = interpolate(data.filePath, prevResult, allResults);
        if (!filePath) return { error: 'Chemin de fichier manquant' };
        const res = await api.readFile(currentProjectPath, filePath);
        return res.success
            ? { content: res.content, path: filePath, size: res.content.length }
            : { error: res.error };
    }

    if (actionSubType === 'write-file') {
        const filePath = interpolate(data.filePath, prevResult, allResults);
        const content = interpolate(data.content, prevResult, allResults);
        const res = await api.writeFile(currentProjectPath, filePath, content);
        return res.success
            ? { written: true, path: filePath }
            : { error: res.error };
    }

    if (actionSubType === 'http-request') {
        const url = interpolate(data.url, prevResult, allResults);
        const method = data.method || 'GET';
        const body = data.body ? interpolate(data.body, prevResult, allResults) : undefined;
        // → appel HTTP via IPC Electron
        const res = await api.httpRequest({ url, method, body, headers: data.headers });
        return res;
    }

    if (actionSubType === 'git-commit') {
        const message = interpolate(data.commitMessage, prevResult, allResults);
        const res = await api.gitCommit(currentProjectPath, message);
        return res;
    }

    // shell par défaut
    const command = interpolate(data.command, prevResult, allResults);
    // ... exécution shell existante
}
```

#### P1.2 — UI de configuration par sous-type

Dans `CustomNode`, remplacer le champ générique par des formulaires spécialisés :

```jsx
{nodeType === 'action' && (() => {
    const subType = data.actionSubType || 'shell';
    return (
        <>
            <div className="vw-node-field">
                <span className="vw-node-label">Type d'action</span>
                <select className="vw-node-select"
                        value={subType}
                        onChange={e => data.onChange?.(id, 'actionSubType', e.target.value)}>
                    <option value="shell">💻 Commande Shell</option>
                    <option value="read-file">📄 Lire Fichier</option>
                    <option value="write-file">✏️ Écrire Fichier</option>
                    <option value="http-request">🔗 Requête HTTP</option>
                    <option value="git-commit">📦 Git Commit</option>
                    <option value="git-diff">🔍 Git Diff</option>
                    <option value="run-tests">🧪 Lancer Tests</option>
                    <option value="run-linter">🔎 Lancer Linter</option>
                </select>
            </div>

            {subType === 'shell' && (
                <input className="vw-node-input" placeholder="ex: npm test"
                       value={data.command || ''}
                       onChange={e => data.onChange?.(id, 'command', e.target.value)} />
            )}
            {subType === 'read-file' && (
                <input className="vw-node-input" placeholder="chemin/vers/fichier.js"
                       value={data.filePath || ''}
                       onChange={e => data.onChange?.(id, 'filePath', e.target.value)} />
            )}
            {subType === 'write-file' && (
                <>
                    <input className="vw-node-input" placeholder="chemin/vers/fichier.js"
                           value={data.filePath || ''}
                           onChange={e => data.onChange?.(id, 'filePath', e.target.value)} />
                    <textarea className="vw-node-input" placeholder="Contenu ({{prev}} pour résultat précédent)"
                              value={data.content || ''}
                              onChange={e => data.onChange?.(id, 'content', e.target.value)} />
                </>
            )}
            {subType === 'http-request' && (
                <>
                    <select className="vw-node-select" value={data.method || 'GET'}
                            onChange={e => data.onChange?.(id, 'method', e.target.value)}>
                        <option>GET</option><option>POST</option>
                        <option>PUT</option><option>DELETE</option>
                    </select>
                    <input className="vw-node-input" placeholder="https://api.example.com/..."
                           value={data.url || ''}
                           onChange={e => data.onChange?.(id, 'url', e.target.value)} />
                </>
            )}
            {subType === 'git-commit' && (
                <input className="vw-node-input" placeholder="Message de commit..."
                       value={data.commitMessage || ''}
                       onChange={e => data.onChange?.(id, 'commitMessage', e.target.value)} />
            )}
        </>
    );
})()}
```

#### P1.3 — Nœuds signatures "IDE dev" à ajouter au catalogue

Ajouter dans `NODE_CATALOG` les nœuds différenciants :

```js
// Nouveaux nœuds à ajouter dans NODE_CATALOG
{ category: 'Dev Tools', type: 'action', label: 'Project Scan', icon: '🗂️',
  desc: 'Scanner les fichiers du projet', actionSubType: 'project-scan' },
{ category: 'Dev Tools', type: 'action', label: 'Search Symbol', icon: '🔎',
  desc: 'Rechercher un symbole dans le code', actionSubType: 'search-symbol' },
{ category: 'Dev Tools', type: 'action', label: 'Apply Patch', icon: '🩹',
  desc: 'Appliquer un patch IA au fichier', actionSubType: 'apply-patch' },
{ category: 'Dev Tools', type: 'action', label: 'Run Tests', icon: '🧪',
  desc: 'Lancer la suite de tests', actionSubType: 'run-tests' },
{ category: 'Dev Tools', type: 'action', label: 'Run Linter', icon: '🔍',
  desc: 'Analyser la qualité du code', actionSubType: 'run-linter' },
{ category: 'Dev Tools', type: 'action', label: 'Git Diff', icon: '📊',
  desc: 'Lire le diff Git courant', actionSubType: 'git-diff' },
{ category: 'Dev Tools', type: 'action', label: 'Start Dev Server', icon: '🚀',
  desc: 'Démarrer le serveur de développement', actionSubType: 'start-dev-server' },
{ category: 'Agents IA', type: 'ai', label: 'Ask Coder Agent', icon: '💻',
  desc: 'Demander au Coder Agent de générer du code', model: 'gemini' },
{ category: 'Agents IA', type: 'ai', label: 'Ask Reviewer Agent', icon: '🔍',
  desc: 'Demander une revue de code à l\'IA', model: 'gemini' },
{ category: 'Agents IA', type: 'ai', label: 'Generate Refactor Plan', icon: '🏗️',
  desc: 'Générer un plan de refactoring', model: 'gemini' },
{ category: 'Logique', type: 'logic', label: 'Gate on Test Result', icon: '🚦',
  desc: 'Bloquer si les tests échouent', logicSubType: 'gate' },
```

**Fichiers à modifier :**

- `client/src/components/VisualWorkflowEditor/index.js` — `NODE_CATALOG`, `CustomNode`
- `client/src/hooks/useWorkflowRunner.js` — `executeNode` avec sous-types
- `electron/ipc/workflowHandlers.js` — nouveaux handlers IPC si nécessaire
- `electron/workflows/visualWorkflowSchema.js` — ajouter `actionSubType`, `logicSubType` dans le schéma

---

### P2 — Ajouter un vrai système de variables / state

**Priorité : Haute**

**Problème identifié dans le code :**

Le système d'interpolation actuel dans `useWorkflowRunner.js` est minimal :

```js
// Actuel : seulement {{prev}} et {{nodeId}}
result = result.replace(/\{\{prev\}\}/g, prevResult || '');
result = result.replace(/\{\{(\w+)\}\}/g, (_, key) => allResults[key] || '');
```

Tout est string. Il n'y a pas de typage, pas de namespace, pas de variables définissables avant l'exécution.

**Ce qu'il faut faire :**

#### P2.1 — Variables de workflow définissables

Ajouter un panneau "Variables" dans l'UI du workflow :

```js
// Nouveau state dans VisualWorkflowEditor
const [workflowVariables, setWorkflowVariables] = useState({});
// Ex: { API_URL: 'https://api.example.com', MAX_RETRIES: '3' }
```

Sérialiser dans le JSON du workflow :

```js
// Dans serializeWorkflow()
return {
    schemaVersion: 2,
    name: workflowName,
    variables: workflowVariables,  // ← nouveau
    nodes: [...],
    edges: [...],
};
```

#### P2.2 — Système de références structuré

Étendre l'interpolation pour supporter :

```js
const interpolate = (text, state) => {
    if (!text) return text;
    return text
        // Variables globales du workflow
        .replace(/\{\{flow\.vars\.(\w+)\}\}/g, (_, key) => state.variables[key] ?? '')
        // Outputs nommés par nœud
        .replace(/\{\{nodes\.(\w+)\.output\}\}/g, (_, nodeId) => state.nodeOutputs[nodeId]?.value ?? '')
        .replace(/\{\{nodes\.(\w+)\.status\}\}/g, (_, nodeId) => state.nodeOutputs[nodeId]?.status ?? '')
        // Compatibilité ascendante
        .replace(/\{\{prev\}\}/g, state.prevResult ?? '')
        .replace(/\{\{(\w+)\}\}/g, (_, key) => state.nodeOutputs[key]?.value ?? state.variables[key] ?? '');
};
```

#### P2.3 — Inspecteur des variables pendant l'exécution

Ajouter dans le panneau de log un onglet "Variables" qui affiche en temps réel :

```jsx
// Dans le panneau d'exécution
{activeTab === 'variables' && (
    <div className="vw-vars-inspector">
        <div className="vw-vars-section">
            <h4>Variables globales</h4>
            {Object.entries(workflowVariables).map(([k, v]) => (
                <div key={k} className="vw-var-row">
                    <span className="vw-var-key">{k}</span>
                    <span className="vw-var-value">{v}</span>
                </div>
            ))}
        </div>
        <div className="vw-vars-section">
            <h4>Outputs des nœuds</h4>
            {Object.entries(nodeResults).map(([nodeId, result]) => (
                <div key={nodeId} className="vw-var-row">
                    <span className="vw-var-key">{nodeId}</span>
                    <span className={`vw-var-value ${result.status}`}>
                        {String(result.value || result.result || '').substring(0, 100)}
                    </span>
                </div>
            ))}
        </div>
    </div>
)}
```

#### P2.4 — Output mapping par nœud

Chaque nœud doit pouvoir nommer son output :

```jsx
// Dans CustomNode, champ commun à tous les types
<div className="vw-node-field vw-node-field-output">
    <span className="vw-node-label">Nom de l'output</span>
    <input className="vw-node-input vw-node-input-small"
           placeholder="ex: testResult"
           value={data.outputName || ''}
           onChange={e => data.onChange?.(id, 'outputName', e.target.value)} />
</div>
```

**Fichiers à modifier :**

- `client/src/hooks/useWorkflowRunner.js` — `interpolate`, `runWorkflow`
- `client/src/components/VisualWorkflowEditor/index.js` — state `workflowVariables`, `serializeWorkflow`, `CustomNode`
- `electron/workflows/visualWorkflowSchema.js` — ajouter `variables` dans le schéma

---

### P3 — Renforcer fortement l'UI d'édition

**Priorité : Moyenne-Haute**

**Problème identifié dans le code :**

Le `CustomNode` actuel est monolithique : toute la configuration est inline dans le nœud sur le canvas. Il n'y a pas de panneau de configuration latéral, pas de validation, pas de distinction design/run.

**Ce qu'il faut faire :**

#### P3.1 — Panneau de configuration latéral (Node Inspector)

Ajouter un panneau droit qui s'ouvre quand un nœud est sélectionné :

```jsx
// Nouveau state dans VisualWorkflowEditor
const [selectedNode, setSelectedNode] = useState(null);

// Handler de sélection
const onNodeClick = useCallback((event, node) => {
    setSelectedNode(node);
}, []);

// Panneau latéral
{selectedNode && (
    <div className="vw-inspector-panel">
        <div className="vw-inspector-header">
            <span>{selectedNode.data.icon} {selectedNode.data.label}</span>
            <button onClick={() => setSelectedNode(null)}>✕</button>
        </div>
        <div className="vw-inspector-body">
            <NodeConfigForm
                node={selectedNode}
                onChange={handleNodeDataChange}
                onValidate={validateNodeConfig}
            />
        </div>
        <div className="vw-inspector-footer">
            {nodeResults[selectedNode.id] && (
                <div className="vw-inspector-result">
                    <h4>Dernier résultat</h4>
                    <pre>{JSON.stringify(nodeResults[selectedNode.id], null, 2)}</pre>
                </div>
            )}
        </div>
    </div>
)}
```

#### P3.2 — Validation du graphe avant exécution

Ajouter une fonction de validation avant `runWorkflow` :

```js
const validateWorkflowGraph = useCallback((nodes, edges) => {
    const errors = [];
    const warnings = [];

    // Vérifier qu'il y a au moins un trigger
    const triggers = nodes.filter(n => n.data?.nodeType === 'trigger');
    if (triggers.length === 0) {
        errors.push('Le workflow doit avoir au moins un nœud Déclencheur');
    }

    // Vérifier les nœuds non connectés
    const connectedIds = new Set([
        ...edges.map(e => e.source),
        ...edges.map(e => e.target)
    ]);
    nodes.forEach(n => {
        if (!connectedIds.has(n.id) && n.data?.nodeType !== 'trigger') {
            warnings.push(`Nœud "${n.data?.label}" non connecté`);
        }
    });

    // Vérifier les champs requis
    nodes.forEach(n => {
        if (n.data?.nodeType === 'ai' && !n.data?.prompt?.trim()) {
            errors.push(`Nœud IA "${n.data?.label}" : prompt manquant`);
        }
        if (n.data?.nodeType === 'action' && !n.data?.command?.trim()
            && !n.data?.filePath?.trim() && !n.data?.url?.trim()) {
            warnings.push(`Nœud Action "${n.data?.label}" : configuration incomplète`);
        }
    });

    return { valid: errors.length === 0, errors, warnings };
}, []);
```

#### P3.3 — Mode Design vs Mode Run

Ajouter un toggle dans la toolbar :

```jsx
const [editorMode, setEditorMode] = useState('design'); // 'design' | 'run'

// Dans la toolbar
<div className="vw-mode-toggle">
    <button
        className={`vw-mode-btn ${editorMode === 'design' ? 'active' : ''}`}
        onClick={() => setEditorMode('design')}
    >
        ✏️ Design
    </button>
    <button
        className={`vw-mode-btn ${editorMode === 'run' ? 'active' : ''}`}
        onClick={() => setEditorMode('run')}
    >
        ▶️ Run
    </button>
</div>
```

En mode `run` : canvas en lecture seule, focus sur les résultats et le log.  
En mode `design` : canvas éditable, focus sur la configuration.

#### P3.4 — Labels sur les edges conditionnels

Pour les edges issus d'un nœud `logic`, afficher le label `true`/`false` :

```js
// Dans onConnect, détecter si la source est un nœud logic
const onConnect = useCallback((params) => {
    const sourceNode = nodes.find(n => n.id === params.source);
    const isConditional = sourceNode?.data?.nodeType === 'logic';
    const edgeLabel = isConditional
        ? (params.sourceHandle === 'true' ? '✓ Vrai' : '✗ Faux')
        : undefined;

    setEdges(eds => addEdge({
        ...params,
        animated: true,
        label: edgeLabel,
        style: { stroke: 'rgba(0,245,212,0.5)' },
        labelStyle: { fill: '#00f5d4', fontSize: 11 }
    }, eds));
}, [nodes, setEdges]);
```

#### P3.5 — Warnings de configuration visibles sur le nœud

```jsx
// Dans CustomNode, afficher un badge d'avertissement
const hasWarning = nodeType === 'ai' && !data.prompt?.trim();
const hasError = nodeType === 'action' && !data.command?.trim()
    && !data.filePath?.trim() && !data.url?.trim();

return (
    <div className={`vw-node ${selected ? 'selected' : ''} ...`}>
        {(hasWarning || hasError) && (
            <div className={`vw-node-badge ${hasError ? 'error' : 'warning'}`}>
                {hasError ? '❌' : '⚠️'}
            </div>
        )}
        ...
    </div>
);
```

**Fichiers à modifier :**

- `client/src/components/VisualWorkflowEditor/index.js` — panneau inspector, validation, mode toggle
- `client/src/components/VisualWorkflowEditor/VisualWorkflow.css` — styles inspector, badges
- `client/src/hooks/useWorkflowRunner.js` — intégrer la validation avant `runWorkflow`

---

### P4 — Construire votre équivalent "Flowise pour le code"

**Priorité : Stratégique — avantage compétitif**

**Contexte :**

C'est la recommandation la plus importante en termes de stratégie.

Ne copiez pas Flowise sur tout.
Faites plutôt un builder spécialisé dev.

Votre avantage est ici : vous avez déjà dans `useAI.js` un système multi-agents sophistiqué (5 agents Gemini/Kimi), un scan projet avancé avec presets `safe`/`full`/`god`, et une intégration native avec l'éditeur, le terminal et Git.

**Ce qu'il faut faire :**

#### P4.1 — Nœuds signatures "Dev Workflow" à implémenter en priorité

Ces nœuds sont votre différenciateur face à Flowise :

| Nœud | Sous-type | Description | Handler IPC |
|------|-----------|-------------|-------------|
| `Project Scan` | `project-scan` | Scanner les fichiers du projet (presets safe/full/god) | `getAllProjectFiles` existant |
| `Search Symbol` | `search-symbol` | Rechercher un symbole/pattern dans le code | `searchInFiles` à créer |
| `Read File` | `read-file` | Lire un fichier avec output structuré | `readFile` existant |
| `Write File` | `write-file` | Écrire dans un fichier avec path + contenu | `writeFile` existant |
| `Apply Patch` | `apply-patch` | Appliquer un patch IA au fichier actif | `applyPatch` existant |
| `Run Tests` | `run-tests` | `npm test` avec parsing du résultat | `startProcess` existant |
| `Run Linter` | `run-linter` | `npm run lint` avec parsing des erreurs | `startProcess` existant |
| `Start Dev Server` | `start-dev-server` | `npm run dev` avec détection du port | `startProcess` existant |
| `Read Git Diff` | `git-diff` | Lire le diff Git courant | `gitHandlers` existant |
| `Create Commit` | `git-commit` | Commit avec message généré par IA | `gitHandlers` existant |
| `Generate Refactor Plan` | `ai` | Prompt IA spécialisé refactoring | `getGeminiCompletion` existant |
| `Ask Coder Agent` | `ai` | Agent codeur (Kimi K2.5 fast) | `getKimiCompletion` existant |
| `Ask Reviewer Agent` | `ai` | Agent reviewer (Gemini thinking) | `getGeminiCompletion` existant |
| `Gate on Test Result` | `logic` | Bloquer si les tests échouent | `evaluateWorkflowCondition` existant |

#### P4.2 — Workflows templates "Dev" pré-installés

Créer des templates de workflows prêts à l'emploi dans le catalogue :

```js
// Nouveau : templates intégrés dans VisualWorkflowEditor
const DEV_WORKFLOW_TEMPLATES = [
    {
        name: 'CI/CD Pipeline',
        description: 'Tests → Build → Commit → Notification',
        nodes: [
            { type: 'trigger', label: 'Déclencheur Manuel', ... },
            { type: 'action', label: 'Run Tests', actionSubType: 'run-tests', ... },
            { type: 'logic', label: 'Tests OK ?', logicSubType: 'gate', ... },
            { type: 'action', label: 'npm build', actionSubType: 'shell',
              command: 'npm run build', ... },
            { type: 'action', label: 'Git Commit', actionSubType: 'git-commit', ... },
            { type: 'output', label: 'Notification succès', ... },
        ],
        edges: [/* ... */]
    },
    {
        name: 'Code Review IA',
        description: 'Lire diff → Analyser avec IA → Rapport',
        nodes: [
            { type: 'trigger', label: 'Déclencheur Manuel', ... },
            { type: 'action', label: 'Read Git Diff', actionSubType: 'git-diff', ... },
            { type: 'ai', label: 'Ask Reviewer Agent',
              prompt: 'Analyse ce diff et identifie les problèmes:\n{{prev}}', ... },
            { type: 'action', label: 'Write File', actionSubType: 'write-file',
              filePath: 'review-report.md', content: '{{prev}}', ... },
            { type: 'output', label: 'Rapport généré', ... },
        ],
        edges: [/* ... */]
    },
    {
        name: 'Refactoring Assisté',
        description: 'Scanner → Planifier → Appliquer → Tester',
        nodes: [
            { type: 'trigger', label: 'Déclencheur Manuel', ... },
            { type: 'action', label: 'Project Scan', actionSubType: 'project-scan', ... },
            { type: 'ai', label: 'Generate Refactor Plan',
              prompt: 'Génère un plan de refactoring pour:\n{{prev}}', ... },
            { type: 'ai', label: 'Ask Coder Agent',
              prompt: 'Applique ce plan:\n{{prev}}', ... },
            { type: 'action', label: 'Run Tests', actionSubType: 'run-tests', ... },
            { type: 'logic', label: 'Tests OK ?', logicSubType: 'gate', ... },
            { type: 'output', label: 'Refactoring terminé', ... },
        ],
        edges: [/* ... */]
    }
];
```

#### P4.3 — Intégration avec le système Multi-IA existant

Votre système multi-agents dans `useAI.js` est déjà très avancé. Il faut le connecter au workflow visuel :

```js
// Nouveau nœud 'ai' avec mode 'multi-agent'
case 'ai': {
    if (data.aiMode === 'multi-agent') {
        // Déclencher le pipeline 5 agents (Chef → Frontend → Backend → Architecte → Scrum)
        const result = await api.getMultiAgentCompletion({
            prompt: interpolate(data.prompt, state),
            projectPath: currentProjectPath,
            agents: data.selectedAgents || ['chef', 'coder', 'reviewer']
        });
        return result;
    }
    // ... mode simple existant
}
```

**Fichiers à modifier :**

- `client/src/components/VisualWorkflowEditor/index.js` — `NODE_CATALOG`, templates, panneau templates
- `client/src/hooks/useWorkflowRunner.js` — nouveaux sous-types dans `executeNode`
- `electron/ipc/workflowHandlers.js` — nouveaux handlers IPC pour les nœuds dev
- `electron/ipc/gitHandlers.js` — exposer `gitDiff` pour le workflow

---

### P5 — Ajouter observabilité et évaluation

**Priorité : Moyenne**

**Problème identifié dans le code :**

Le log d'exécution actuel dans `useWorkflowRunner.js` est basique :

```js
const log = useCallback((nodeId, type, message) => {
    const entry = {
        nodeId,
        type,      // 'info' | 'success' | 'error' | 'output'
        message,
        timestamp: new Date().toLocaleTimeString('fr-FR'),
        // ← pas de durée, pas d'input/output structuré, pas d'export
    };
    setExecutionLog(prev => [...prev, entry]);
}, []);
```

**Ce qu'il faut faire :**

#### P5.1 — Timeline d'exécution avec durées

Enrichir le log avec les durées par nœud :

```js
// Dans executeNode, mesurer la durée
const executeNodeWithTiming = async (node, state) => {
    const startTime = Date.now();
    try {
        const result = await executeNode(node, state);
        const duration = Date.now() - startTime;
        return {
            nodeId: node.id,
            label: node.data?.label,
            status: 'success',
            result,
            duration,
            startedAt: new Date(startTime).toISOString(),
            input: { prev: state.prevResult }
        };
    } catch (err) {
        const duration = Date.now() - startTime;
        return {
            nodeId: node.id,
            label: node.data?.label,
            status: 'error',
            error: err.message,
            duration,
            startedAt: new Date(startTime).toISOString()
        };
    }
};
```

#### P5.2 — Affichage timeline dans le panneau de log

Remplacer la liste de logs par une timeline visuelle :

```jsx
// Nouveau composant ExecutionTimeline
const ExecutionTimeline = ({ runs }) => (
    <div className="vw-timeline">
        {runs.map((entry, idx) => (
            <div key={idx} className={`vw-timeline-entry ${entry.status}`}>
                <div className="vw-timeline-dot" />
                <div className="vw-timeline-content">
                    <div className="vw-timeline-header">
                        <span className="vw-timeline-label">{entry.label}</span>
                        <span className="vw-timeline-duration">{entry.duration}ms</span>
                        <span className={`vw-timeline-status ${entry.status}`}>
                            {entry.status === 'success' ? '✅' : '❌'}
                        </span>
                    </div>
                    {entry.result && (
                        <div className="vw-timeline-output">
                            {String(entry.result).substring(0, 200)}
                        </div>
                    )}
                </div>
            </div>
        ))}
    </div>
);
```

#### P5.3 — Export JSON des runs

Ajouter un bouton d'export dans le panneau de log :

```js
const exportRunAsJSON = useCallback(() => {
    const runData = {
        workflowName,
        executedAt: new Date().toISOString(),
        duration: totalDuration,
        nodes: Object.entries(nodeResults).map(([nodeId, result]) => ({
            nodeId,
            label: nodes.find(n => n.id === nodeId)?.data?.label,
            ...result
        })),
        log: executionLog
    };
    const json = JSON.stringify(runData, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `run-${workflowName}-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
}, [workflowName, nodeResults, executionLog, nodes]);
```

#### P5.4 — Historique des runs par workflow

Sauvegarder les runs dans un fichier local :

```js
// Dans workflowHandlers.js, nouveau handler
handle('save-workflow-run', async (event, projectPath, workflowName, runData) => {
    const runsDir = path.join(projectPath, '.vibe-workflows', 'runs');
    await fs.mkdir(runsDir, { recursive: true });
    const filename = `${workflowName}-${Date.now()}.json`;
    await fs.writeFile(path.join(runsDir, filename), JSON.stringify(runData, null, 2));
    return { success: true, filename };
});

handle('list-workflow-runs', async (event, projectPath, workflowName) => {
    const runsDir = path.join(projectPath, '.vibe-workflows', 'runs');
    const files = await fs.readdir(runsDir);
    const runs = files
        .filter(f => f.startsWith(workflowName) && f.endsWith('.json'))
        .sort()
        .reverse()
        .slice(0, 20); // 20 derniers runs
    return { success: true, runs };
});
```

#### P5.5 — Comparatif entre versions de workflow

Ajouter dans le panneau "Mes Workflows" un bouton "Voir les runs" :

```jsx
// Dans le panneau saved workflows
{savedWorkflows.map(wf => (
    <div key={wf.filename} className="vw-saved-item">
        <button onClick={() => loadSavedWorkflow(wf.filename)}>
            {wf.name} — {wf.nodeCount} nœuds
        </button>
        <button onClick={() => openRunHistory(wf.name)} title="Historique des runs">
            📊
        </button>
    </div>
))}
```

#### P5.6 — Métriques globales dans la toolbar

Afficher des métriques simples après chaque run :

```jsx
// Dans la toolbar, après exécution
{lastRunStats && (
    <div className="vw-run-stats">
        <span>⏱ {lastRunStats.totalDuration}ms</span>
        <span>✅ {lastRunStats.successCount}</span>
        <span>❌ {lastRunStats.errorCount}</span>
    </div>
)}
```

**Fichiers à modifier :**

- `client/src/hooks/useWorkflowRunner.js` — timing, structured results
- `client/src/components/VisualWorkflowEditor/index.js` — timeline, export, stats
- `client/src/components/VisualWorkflowEditor/VisualWorkflow.css` — styles timeline
- `electron/ipc/workflowHandlers.js` — handlers save-run, list-runs

---

## Récapitulatif des priorités

| Priorité | Titre | Impact | Effort | Fichiers principaux |
|----------|-------|--------|--------|---------------------|
| **P0** | Moteur d'exécution réel (graphe + routage conditionnel) | 🔴 Critique | 🔴 Élevé | `useWorkflowRunner.js`, `VisualWorkflowEditor/index.js`, `visualWorkflowSchema.js` |
| **P1** | Spécialisation des nœuds (sous-types + UI dédiée) | 🔴 Critique | 🟠 Moyen | `useWorkflowRunner.js`, `VisualWorkflowEditor/index.js` |
| **P2** | Système de variables / state structuré | 🟠 Haute | 🟠 Moyen | `useWorkflowRunner.js`, `VisualWorkflowEditor/index.js`, `visualWorkflowSchema.js` |
| **P3** | UI d'édition renforcée (inspector, validation, mode) | 🟠 Haute | 🟠 Moyen | `VisualWorkflowEditor/index.js`, `VisualWorkflow.css` |
| **P4** | Builder "Flowise pour le code" (nœuds dev + templates) | 🟡 Stratégique | 🔴 Élevé | Tous les fichiers workflow + `gitHandlers.js` |
| **P5** | Observabilité et évaluation (timeline, export, historique) | 🟡 Moyenne | 🟢 Faible | `useWorkflowRunner.js`, `workflowHandlers.js` |

---

## Ordre d'implémentation recommandé

### Sprint 1 — Fondations (P0 + P1 partiels)

1. **P0.1** : Remplacer la boucle linéaire par un moteur de graphe avec routage
2. **P0.2** : Ajouter les deux handles de sortie sur le nœud `logic`
3. **P1.1** : Implémenter `read-file` et `write-file` comme sous-types distincts
4. **P1.2** : Ajouter le sélecteur de sous-type dans l'UI du nœud `action`
5. **P5.1** : Ajouter le timing par nœud dans le log (effort minimal, impact immédiat)

### Sprint 2 — Spécialisation (P1 complet + P2)

1. **P1.3** : Ajouter les nœuds `Run Tests`, `Git Diff`, `Apply Patch` au catalogue
2. **P0.3** : Implémenter le comportement réel du nœud `Boucle`
3. **P2.1** : Variables de workflow définissables
4. **P2.2** : Système de références structuré (`{{flow.vars.xxx}}`)
5. **P2.4** : Output mapping par nœud (`outputName`)

### Sprint 3 — UX et observabilité (P3 + P5)

1. **P3.1** : Panneau de configuration latéral (Node Inspector)
2. **P3.2** : Validation du graphe avant exécution
3. **P3.3** : Mode Design vs Mode Run
4. **P5.2** : Timeline d'exécution visuelle
5. **P5.3** : Export JSON des runs

### Sprint 4 — Différenciation (P4)

1. **P4.1** : Nœuds signatures dev (Project Scan, Ask Coder Agent, Gate on Test Result)
2. **P4.2** : Templates de workflows dev pré-installés
3. **P4.3** : Intégration avec le système Multi-IA existant
4. **P5.4** : Historique des runs par workflow

---

## Direction recommandée

Si votre question est :

> "Doit-on ressembler à Flowise ?"

La réponse est :

- **oui** sur la rigueur d'orchestration
- **non** sur le positionnement produit

La meilleure cible est :

- moins "plateforme généraliste de flows IA"
- plus "IDE desktop AI-native avec orchestration visuelle spécialisée pour les tâches de dev"

---

## Note finale

Aujourd'hui, votre workflow visuel est prometteur, visuellement convaincant, et déjà utile dans le contexte du produit.

L'analyse du code réel confirme que :

- le moteur d'exécution est plus avancé qu'il n'y paraît (tri topologique correct, streaming output, multi-providers IA)
- mais l'écart sémantique avec Flowise reste important (exécution linéaire, nœuds non spécialisés, pas d'état structuré)
- les fondations sont saines : schéma de validation, migration automatique, brouillon localStorage, import/export JSON

Face à Flowise, il faut être lucide :

- l'écart est encore important en profondeur fonctionnelle
- l'écart est rattrapable si vous concentrez l'effort sur le moteur (P0), les nœuds spécialisés (P1) et l'observabilité (P5)
- vous n'avez pas besoin de battre Flowise sur tous ses terrains pour construire un meilleur produit pour les développeurs

Votre avantage compétitif réel est dans la combinaison unique :

> **Multi-IA (Gemini + Kimi + Ollama + Claude + 5 agents) × IDE natif (éditeur + terminal + Git + preview) × Workflow visuel orienté dev**

Aucun autre outil ne propose cette combinaison aujourd'hui.
