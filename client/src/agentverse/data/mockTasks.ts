import type { Task } from '../types';

/** Seed board so the world feels alive before any instruction is sent. */
export function createTasks(): Task[] {
  const now = Date.now();
  const seeds: Array<Omit<Task, 'createdAt'>> = [
    { id: 't1', title: 'Refondre le parcours d\'onboarding', status: 'in_progress', tag: 'design', assigneeId: 'ux' },
    { id: 't2', title: 'Composant "Partager cette recette"', status: 'in_progress', tag: 'feature', assigneeId: 'frontend' },
    { id: 't3', title: 'Endpoint /recipes/:id/share', status: 'todo', tag: 'feature', assigneeId: 'backend' },
    { id: 't4', title: 'Plan de tests partage social', status: 'todo', tag: 'chore', assigneeId: 'qa' },
    { id: 't5', title: 'Pipeline CI preview deploy', status: 'in_progress', tag: 'chore', assigneeId: 'devops' },
    { id: 't6', title: 'Spéc. critères d\'acceptation v3.1', status: 'done', tag: 'chore', assigneeId: 'pm' },
    { id: 't7', title: 'Dark mode tokens', status: 'done', tag: 'feature', assigneeId: 'frontend' },
    { id: 't8', title: 'Fix: avatar 404 sur profil', status: 'todo', tag: 'bug', assigneeId: 'backend' },
  ];

  return seeds.map((seed, i) => ({ ...seed, createdAt: now - (seeds.length - i) * 60_000 }));
}
