import type { Agent, AgentRoleKey, AvatarPalette, Vec2 } from '../types';

/**
 * Simulated team. Each agent maps to a role key in the existing
 * `multiAgentConfig` (see `systemRoleKey`) so the RPG layer can later be wired
 * to the real multi-agent runtime instead of the mock client.
 */
interface AgentSeed {
  id: string;
  name: string;
  role: string;
  roleKey: AgentRoleKey;
  systemRoleKey: string;
  blurb: string;
  accent: string;
  palette: AvatarPalette;
  home: Vec2;
}

const SEEDS: AgentSeed[] = [
  {
    id: 'pm',
    name: 'Aria',
    role: 'Product Manager',
    roleKey: 'pm',
    systemRoleKey: 'captain',
    blurb: "Cadre le plan, les critères d'acceptation et la livraison.",
    accent: '#818cf8',
    palette: { skin: '#f1c9a5', hair: '#3a2e2a', outfit: '#6366f1', accent: '#c7d2fe' },
    home: { x: 3, y: 3 },
  },
  {
    id: 'ux',
    name: 'Mia',
    role: 'UX Designer',
    roleKey: 'ux',
    systemRoleKey: 'ux',
    blurb: "Parcours utilisateur, frictions et critères d'expérience.",
    accent: '#f472b6',
    palette: { skin: '#f3cda8', hair: '#7c3a2d', outfit: '#db2777', accent: '#fbcfe8' },
    home: { x: 7, y: 3 },
  },
  {
    id: 'frontend',
    name: 'Leo',
    role: 'Frontend Developer',
    roleKey: 'frontend',
    systemRoleKey: 'frontend',
    blurb: 'Composants, états, interactions et style.',
    accent: '#22d3ee',
    palette: { skin: '#e8b48f', hair: '#1f2937', outfit: '#06b6d4', accent: '#a5f3fc' },
    home: { x: 12, y: 3 },
  },
  {
    id: 'backend',
    name: 'Noah',
    role: 'Backend Developer',
    roleKey: 'backend',
    systemRoleKey: 'apiData',
    blurb: 'API, données, auth et intégrations serveur.',
    accent: '#f59e0b',
    palette: { skin: '#d9a066', hair: '#2b2b2b', outfit: '#f59e0b', accent: '#fde68a' },
    home: { x: 3, y: 7 },
  },
  {
    id: 'qa',
    name: 'Zoe',
    role: 'QA Tester',
    roleKey: 'qa',
    systemRoleKey: 'qa',
    blurb: 'Tests, scénarios utilisateur et definition of done.',
    accent: '#34d399',
    palette: { skin: '#f1c9a5', hair: '#2d2a32', outfit: '#22c55e', accent: '#bbf7d0' },
    home: { x: 7, y: 7 },
  },
  {
    id: 'devops',
    name: 'Sam',
    role: 'DevOps',
    roleKey: 'devops',
    systemRoleKey: 'gitRelease',
    blurb: 'CI, Git, release et déploiement.',
    accent: '#a78bfa',
    palette: { skin: '#c68642', hair: '#111827', outfit: '#8b5cf6', accent: '#ddd6fe' },
    home: { x: 12, y: 7 },
  },
];

/** Build a fresh, independent set of agents (safe to mutate in engine state). */
export function createAgents(): Agent[] {
  return SEEDS.map((seed) => ({
    ...seed,
    palette: { ...seed.palette },
    home: { ...seed.home },
    pos: { ...seed.home },
    target: { ...seed.home },
    facing: 'down',
    status: 'idle',
    bubble: null,
    progress: 0,
    chat: [],
  }));
}
