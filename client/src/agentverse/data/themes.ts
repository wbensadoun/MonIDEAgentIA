import type { ThemeId, ThemeMeta } from '../types';

export const THEMES: Record<ThemeId, ThemeMeta> = {
  town: {
    id: 'town',
    name: 'Monster Town',
    tagline: 'Village JRPG original, routes et agents pixel',
    movement: 'grid',
    cols: 16,
    rows: 11,
    accent: '#3f8f68',
    pixel: true,
    badge: 'Town',
    walkable: { x0: 2, y0: 0, x1: 15, y1: 10 },
  },
  cyberpunk: {
    id: 'cyberpunk',
    name: 'Cyber Deck',
    tagline: 'Ville neon, data bar et drones',
    movement: 'free',
    cols: 16,
    rows: 11,
    accent: '#c026d3',
    pixel: false,
    badge: 'Cyberpunk',
  },
  isometric: {
    id: 'isometric',
    name: 'Agent HQ',
    tagline: 'Bâtiment isométrique, salles par métier',
    movement: 'free',
    cols: 16,
    rows: 11,
    accent: '#3b82f6',
    pixel: false,
    badge: 'Isométrique',
  },
  campus: {
    id: 'campus',
    name: 'RPG Guild',
    tagline: 'Guilde fantasy, quetes et equipement',
    movement: 'grid',
    cols: 16,
    rows: 11,
    accent: '#d6a13f',
    pixel: true,
    badge: 'RPG',
  },
  synthwave: {
    id: 'synthwave',
    name: 'Retro Grid',
    tagline: 'Synthwave 80s, horizon néon & soleil',
    movement: 'free',
    cols: 16,
    rows: 11,
    accent: '#fb7185',
    pixel: false,
    badge: 'Synthwave',
  },
  tamers: {
    id: 'tamers',
    name: 'Monster Tamers',
    tagline: 'Créatures originales, overworld pixel, aventure',
    movement: 'grid',
    cols: 16,
    rows: 11,
    accent: '#f59e0b',
    pixel: true,
    badge: 'Tamers',
    walkable: { x0: 3, y0: 0, x1: 15, y1: 10 },
  },
};

export const THEME_ORDER: ThemeId[] = [
  'town',
  'cyberpunk',
  'isometric',
  'campus',
  'synthwave',
  'tamers',
];

export const DEFAULT_THEME: ThemeId = 'town';

/* ============================================================================
   PREP — 5 nouvelles palettes (pas d'exécution aujourd'hui)
   ============================================================================
   Objectif : donner à chaque theme existant (et aux prochains) un
   ThemePalette complet (primary/danger/success/warning/info — voir
   ThemeMeta.palette dans ../types.ts) au lieu du seul `accent` actuel, et
   préparer 5 nouveaux ThemeId vendables en plus des 6 existants.

   Sourcing des couleurs (à valider par l'audit design avant intégration) :
   - VS Code themes (repo microsoft/vscode + marketplace) : bonnes palettes
     "developer-tool" déjà éprouvées en contraste sur fond sombre, proches
     de nos 4 thèmes dark existants (midnight/amber/mint/violet dans
     styles/tokens.css).
   - Material Design 3 color roles (m3.material.io) : source la plus
     complète pour les slots sémantiques (primary/error/success n'existe
     pas nativement côté MD3 mais se mappe bien depuis leurs tons).
   - Tailwind CSS palette (tailwindcss.com/docs/colors) : déjà la source
     des accents actuels (ex. accent violet #8b5cf6 = violet-500 Tailwind,
     mint #10b981 = emerald-500) — cohérence à garder pour les nouvelles.
   - Radix Colors (radix-ui.com/colors) : palettes accessibles avec paires
     clair/sombre déjà calculées pour contraste AA — utile si un thème
     clair supplémentaire est ajouté (paper est le seul actuellement).

   Étapes concrètes pour l'implémentation réelle (hors scope ici) :
   1. Choisir 5 noms/thèmes (ex. desert, arctic, forest, noir, sakura).
   2. Étendre ThemeId dans ../types.ts avec les 5 nouveaux littéraux.
   3. Ajouter chaque entrée ici avec accent + palette{primary,danger,
      success,warning,info} + cols/rows/movement/pixel/badge/walkable.
   4. Ajouter les 5 au THEME_ORDER ci-dessus (ordre = ordre d'affichage
      dans le sélecteur de thème AgentVerse).
   5. Vérifier consumers : engine/useAgentWorld.ts, components/Topbar.tsx,
      index.tsx (voir liste de dépendances ci-dessous).

   Fichiers qui dépendent des thèmes AgentVerse (à mettre à jour/vérifier
   si de nouveaux ThemeId sont ajoutés) :
   - client/src/agentverse/types.ts            (ThemeId union, ThemeMeta)
   - client/src/agentverse/data/themes.ts       (ce fichier)
   - client/src/agentverse/index.tsx            (sélection du thème actif)
   - client/src/agentverse/components/Topbar.tsx (sélecteur de thème UI)
   - client/src/agentverse/engine/movement.test.ts (tests référençant des
     ThemeId/THEMES existants — à étendre si comportement grid/free varie)
   ============================================================================ */
