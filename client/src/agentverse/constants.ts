import type { AgentStatus } from './types';

/**
 * Canonical FR status labels — the single source shared by the roster
 * (AgentStatusPanel), the NPC aria-label (AgentNPC) and the dialogue header
 * (DialoguePanel). Keeps the three views from drifting apart.
 */
export const STATUS_LABEL: Record<AgentStatus, string> = {
  idle: 'Disponible',
  walking: 'En déplacement',
  working: 'Au travail',
  talking: 'En discussion',
  blocked: 'Bloqué',
};
