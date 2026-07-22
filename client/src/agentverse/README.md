# AgentVerse

Interface multi-agents facon RPG 2D : les agents IA sont des PNJ dans un monde
vivant (deplacements automatiques, bulles de dialogue, click-to-talk), avec un
tableau de taches partage Todo / In Progress / Done.

**Un seul moteur, six skins revendables** : `town` (village JRPG), `cyberpunk`
(ville neon), `isometric` (salles metier), `campus` (RPG Guild), `synthwave`
(retro 80s), `tamers` (Monster Tamers - creatures originales, overworld pixel).

## Utilisation

```tsx
import AgentVerse from './agentverse';

<AgentVerse />                   // auto: bridge IA de l'IDE si dispo, sinon mock
<AgentVerse client={myClient} /> // backend LLM custom (voir plus bas)
```

### Mode Live vs Demo (auto-detection)

`AgentVerse` detecte automatiquement le backend :

- **Live IA** -- si `window.electronAPI` expose une fonction de completion
  (`get{Gemini,Claude,Kimi,Ollama}Completion`). Les agents repondent via le
  vrai moteur IA de l'IDE, avec une persona par role. Le provider/modele est lu
  depuis les **Settings** de l'IDE.
- **Demo** -- sinon (ex. navigateur seul), un client mock repond localement.

Le badge en haut a gauche indique le mode courant.

Dans cet IDE il est monte comme onglet central **Agents**
(`client/src/components/AppShell/WorkspaceLayout.js`).

## Structure

| Dossier | Role |
|---|---|
| `types.ts` | Modele de domaine (Agent, Task, Theme...) |
| `data/` | `mockAgents`, `mockTasks`, `themes` |
| `engine/` | `useAgentWorld` (boucle de tick + state-machine), `movement`, `reactions` |
| `llm/` | `agentClient` (mock) - `electronAgentClient` (bridge IA reel) - `electronApi` (typings) |
| `components/` | `GameWorld`, `PhaserTownWorld`, `PhaserTamersWorld`, `AgentNPC`, `SpeechBubble`, `DialoguePanel`, `TaskBoard`, `AgentStatusPanel`, `AgentAvatar`, `Topbar` |
| `AgentVerse.css` + `themes.css` | coeur (tokens) + skins |

## Brancher de vrais agents LLM

Deja branche sur l'IDE via `llm/electronAgentClient.ts` (utilise
automatiquement en mode Live). Pour un autre backend, implemente l'interface
`AgentClient` (`types.ts`) et passe-la en prop :

```ts
const client: AgentClient = {
  async sendInstruction(agent, prompt) {
    const reply = await callRealAgent(agent.systemRoleKey, prompt); // window.electronAPI / HTTP
    return { taskTitle: prompt, reply, durationMs: 6000 };
  },
};
```

Chaque role a une **persona** dediee (`ROLE_PERSONA` dans `electronAgentClient.ts`)
qui cadre la reponse (PM vs UX vs backend...). Le client rejoue les ~6 derniers
messages du fil de l'agent pour garder le contexte.

Chaque agent expose `systemRoleKey`, aligne sur `utils/multiAgentConfig.js` :

| RPG | systemRoleKey |
|---|---|
| Product Manager | `captain` |
| UX Designer | `ux` |
| Frontend Developer | `frontend` |
| Backend Developer | `apiData` |
| QA Tester | `qa` |
| DevOps | `gitRelease` |

## Ajouter un theme

1. Ajouter une entree dans `data/themes.ts` (+ `THEME_ORDER`).
2. Definir `.av-root--<id>` (tokens) et `.av-world--<id>` (decor) dans `themes.css`.

Le moteur et les composants sont agnostiques au theme -- aucune logique a toucher.

## Contrainte build

Le client est un Create React App `react-scripts@5.0.0` => **TypeScript 4** requis
(`typescript@4.9.5`, ne pas passer a TS 5). `client/tsconfig.json` a `types: []` et
un `include` scope a `agentverse` pour ne pas type-checker les `.js` existants.
