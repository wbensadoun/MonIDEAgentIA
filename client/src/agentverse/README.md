# AgentVerse

Interface multi-agents faÃ§on RPG 2D : les agents IA sont des PNJ dans un monde
vivant (dÃ©placements automatiques, bulles de dialogue, click-to-talk), avec un
tableau de tÃ¢ches partagÃ© Todo / In Progress / Done.

**Un seul moteur, cinq skins revendables** : `town` (village JRPG original),
`cyberpunk` (ville neon), `isometric` (salles metier), `campus`
(RPG Guild), `synthwave` (retro 80s).

## Utilisation

```tsx
import AgentVerse from './agentverse';

<AgentVerse />                   // auto: bridge IA de l'IDE si dispo, sinon mock
<AgentVerse client={myClient} /> // backend LLM custom (voir plus bas)
```

### Mode Live vs DÃ©mo (auto-dÃ©tection)

`AgentVerse` dÃ©tecte automatiquement le backend :

- **Live IA** â€” si `window.electronAPI` expose une fonction de complÃ©tion
  (`get{Gemini,Claude,Kimi,Ollama}Completion`). Les agents rÃ©pondent via le
  vrai moteur IA de l'IDE, avec une persona par rÃ´le. Le provider/modÃ¨le est lu
  depuis les **Settings** de l'IDE.
- **DÃ©mo** â€” sinon (ex. navigateur seul), un client mock rÃ©pond localement.

Le badge en haut Ã  gauche indique le mode courant.

Dans cet IDE il est montÃ© comme onglet central **Â« Agents Â»**
(`client/src/components/AppShell/WorkspaceLayout.js`).

## Structure

| Dossier | RÃ´le |
|---|---|
| `types.ts` | ModÃ¨le de domaine (Agent, Task, Themeâ€¦) |
| `data/` | `mockAgents`, `mockTasks`, `themes` |
| `engine/` | `useAgentWorld` (boucle de tick + state-machine), `movement`, `reactions` |
| `llm/` | `agentClient` (mock) Â· `electronAgentClient` (bridge IA rÃ©el) Â· `electronApi` (typings) |
| `components/` | `GameWorld`, `PhaserPixelWorld`, `AgentNPC`, `SpeechBubble`, `DialoguePanel`, `TaskBoard`, `AgentStatusPanel`, `AgentAvatar`, `Topbar` |
| `AgentVerse.css` + `themes.css` | cÅ“ur (tokens) + skins |

## Brancher de vrais agents LLM

DÃ©jÃ  branchÃ© sur l'IDE via `llm/electronAgentClient.ts` (utilisÃ©
automatiquement en mode Live). Pour un autre backend, implÃ©mente l'interface
`AgentClient` (`types.ts`) et passe-la en prop :

```ts
const client: AgentClient = {
  async sendInstruction(agent, prompt) {
    const reply = await callRealAgent(agent.systemRoleKey, prompt); // window.electronAPI / HTTP
    return { taskTitle: prompt, reply, durationMs: 6000 };
  },
};
```

Chaque rÃ´le a une **persona** dÃ©diÃ©e (`ROLE_PERSONA` dans `electronAgentClient.ts`)
qui cadre la rÃ©ponse (PM vs UX vs backendâ€¦). Le client rejoue les ~6 derniers
messages du fil de l'agent pour garder le contexte.

Chaque agent expose `systemRoleKey`, alignÃ© sur `utils/multiAgentConfig.js` :

| RPG | systemRoleKey |
|---|---|
| Product Manager | `captain` |
| UX Designer | `ux` |
| Frontend Developer | `frontend` |
| Backend Developer | `apiData` |
| QA Tester | `qa` |
| DevOps | `gitRelease` |

## Ajouter un thÃ¨me

1. Ajouter une entrÃ©e dans `data/themes.ts` (+ `THEME_ORDER`).
2. DÃ©finir `.av-root--<id>` (tokens) et `.av-world--<id>` (dÃ©cor) dans `themes.css`.

Le moteur et les composants sont agnostiques au thÃ¨me â€” aucune logique Ã  toucher.

## Contrainte build

Le client est un Create React App `react-scripts@5.0.0` â†’ **TypeScript 4** requis
(`typescript@4.9.5`, ne pas passer Ã  TS 5). `client/tsconfig.json` a `types: []` et
un `include` scopÃ© Ã  `agentverse` pour ne pas type-checker les `.js` existants.
