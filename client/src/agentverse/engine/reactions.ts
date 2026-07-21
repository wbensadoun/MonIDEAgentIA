import type { AgentRoleKey } from '../types';
import { pick } from './movement';

/** Ambient one-liners shown randomly above idle agents, flavored per role.
 *  Each role has both "human" lines and "creature" lines — picked at random
 *  so the Tamers theme feels alive and in-universe. */
const IDLE_LINES: Record<AgentRoleKey, string[]> = {
  pm: ['On garde le cap 🎯', 'Specs à jour ?', 'Priorité au partage social', 'Le goal avant tout',
       'Ordrix rugit doucement ✨', 'La couronne pulse…', 'Vision claire !'],
  ux: ['Je teste le parcours…', 'Friction ici 🤔', 'Wireframe v2 prêt', 'Plus lisible comme ça',
       'Lumiole scintille 🌟', 'Ailes déployées…', 'Beau flow !'],
  frontend: ['Build au vert ✅', 'Petit refacto du state', 'Dark mode stylé 🌙', 'Composant réutilisable',
             'Zappix charge ⚡', 'Crête orange levée !', 'Éclair en route'],
  backend: ['200 OK partout', 'Cache invalidé', 'Migration prête', 'Latence sous contrôle',
            'Grotthar est solide 🪨', 'La gemme brille…', 'Roche et acier'],
  qa: ['Edge case repéré 🐛', 'Tests au vert', 'Scénario rejoué', 'Definition of done ?',
       'Debugorn scrute 🔍', 'Radar en alerte !', 'Aucun bug ne passe'],
  devops: ['Pipeline OK ⚙️', 'Preview déployée', 'Logs propres', 'Rollback prêt au cas où',
           'Vyntrok en vol 🚀', 'Jets allumés !', 'Visor scan OK'],
};

/** Lines shown while an agent is actively working on an instruction. */
const WORK_LINES: Record<AgentRoleKey, string[]> = {
  pm: ['Je cadre le besoin…', 'Découpage en cours', "J'écris les critères"],
  ux: ['Je maquette ça…', 'Je revois le flow', 'Prototype en cours'],
  frontend: ['Je code le composant…', 'Je branche le state', 'Je peaufine le style'],
  backend: ["Je monte l'endpoint…", 'Je modélise les données', "Je gère l'auth"],
  qa: ["J'écris les tests…", 'Je rejoue les scénarios', 'Je chasse les régressions'],
  devops: ['Je règle la CI…', 'Je prépare le deploy', 'Je vérifie les secrets'],
};

/** Reactions from bystanders when a teammate starts a task. */
const REACT_LINES: string[] = [
  'OK je m’aligne 👍',
  'Je review après',
  'Je prends le relais derrière',
  'Compris, je suis dispo',
  'Je prépare les tests',
  'Nickel, on avance 🚀',
  'Je garde un œil',
];

/** Closing lines when a task is delivered. */
const DONE_LINES: string[] = ['Livré ✅', 'Terminé !', 'C’est mergé 🎉', 'Done ✨', 'Ça part en preview'];

export function idleLine(role: AgentRoleKey): string {
  return pick(IDLE_LINES[role]);
}

export function workLine(role: AgentRoleKey): string {
  return pick(WORK_LINES[role]);
}

export function reactLine(): string {
  return pick(REACT_LINES);
}

export function doneLine(): string {
  return pick(DONE_LINES);
}
