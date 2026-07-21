import type { Agent, AgentClient, InstructionResult } from '../types';
import { randInt } from '../engine/movement';

/**
 * Mock backend used while there is no server.
 *
 * To connect real LLM agents later, implement {@link AgentClient} (e.g. call
 * `window.electronAPI` or an HTTP endpoint) and pass it to `<AgentVerse client={...} />`.
 * The rest of the engine is agnostic to where the reply comes from.
 */
export function createMockAgentClient(): AgentClient {
  return {
    sendInstruction(agent: Agent, prompt: string): Promise<InstructionResult> {
      const clean = prompt.trim();
      const taskTitle = clean.length > 60 ? `${clean.slice(0, 57)}…` : clean || 'Nouvelle tâche';
      const reply = buildReply(agent, clean);
      // Simulate "thinking + working" time so the world animates believably.
      const durationMs = randInt(4500, 8500);
      return new Promise((resolve) => {
        // Small latency before the agent "accepts" the task.
        window.setTimeout(() => resolve({ taskTitle, reply, durationMs }), randInt(250, 700));
      });
    },
  };
}

function buildReply(agent: Agent, prompt: string): string {
  const subject = prompt ? `« ${prompt} »` : 'la demande';
  const role = agent.role.toLowerCase();
  const closer = ROLE_CLOSERS[agent.roleKey] ?? 'Je te tiens au courant dès que c’est prêt.';
  return `Bien reçu ! En tant que ${role}, je m’occupe de ${subject}. ${closer}`;
}

const ROLE_CLOSERS: Record<string, string> = {
  pm: 'Je découpe en sous-tâches et je fixe les critères d’acceptation.',
  ux: 'Je pars sur une maquette lisible avant de la passer au frontend.',
  frontend: 'Je crée le composant, branche l’état et soigne les interactions.',
  backend: 'Je monte l’endpoint, sécurise l’accès et renvoie un contrat propre.',
  qa: 'Je couvre les cas limites et j’ajoute les tests de non-régression.',
  devops: 'Je prépare la CI, la preview et un rollback de sécurité.',
};
