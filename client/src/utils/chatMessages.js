/**
 * Adaptateur historique de conversation -> modele MessageViewer.
 *
 * 1.4c. La production (AIChat/index.js) stocke des entrees plates
 * `{ role, text, agentProvider?, agentName?, id? }` produites par useAI.js
 * (useAI.js:339, :475, :595...) et les rend inline dans une boucle de 130
 * lignes. MessageViewer, lui, consomme des `ChatMessage` a blocs typés.
 * Le swap gardé de 1.4c a besoin d'une traduction entre les deux, et cette
 * traduction est la seule partie qui porte du risque de perte de donnees —
 * d'ou son extraction ici, testable sans monter de DOM.
 *
 * Trois comportements de la boucle actuelle sont repris tels quels, parce
 * que chacun corrige un bug deja rencontre en production :
 *   1. les segments <think> deviennent des blocs `reasoning` (index.js:1432),
 *      pas du texte visible ;
 *   2. une reponse assistant vide produit un bloc `empty` explicite plutot
 *      qu'une bulle blanche (garde-fou ollama, index.js:1435) ;
 *   3. le badge agent reste neutre : le provider et le nom interne ne sont
 *      jamais affiches dans une bulle de conversation.
 */
import { splitReasoningSegments } from './streamParsing';
import { OPAQUE_AGENT_LABEL } from './rendererOpacity';

/** `model` est le role renvoyé par useAI ; MessageViewer parle `assistant`. */
export const normalizeRole = (role) => {
  if (role === 'user') return 'user';
  if (role === 'system') return 'system';
  return 'assistant';
};

/**
 * Badge affiche sur la bulle. Retourne undefined (et non une chaine vide)
 * quand il n'y a rien a afficher, pour que MessageViewer n'insere pas un
 * span vide dans l'en-tete.
 */
export const buildAgentLabel = (entry) => {
  const name = String(entry?.agentName || '').trim();
  const provider = String(entry?.agentProvider || '').trim();
  return name || provider ? OPAQUE_AGENT_LABEL : undefined;
};

/**
 * @param {object} entry  entree brute de conversationHistory
 * @param {number} index  position, utilisee pour l'id de repli
 * @param {number} [now]  horodatage injecte (les entrees n'en portent pas) —
 *                        parametre explicite pour garder la fonction pure.
 */
export const toChatMessage = (entry, index, now = 0) => {
  const role = normalizeRole(entry?.role);
  const segments = splitReasoningSegments(entry?.text);

  let blocks;
  if (segments.length === 0) {
    // Un utilisateur qui n'a rien ecrit ne peut pas exister (l'envoi est
    // bloque en amont) : seul l'assistant merite le bloc d'avertissement.
    blocks = role === 'assistant' ? [{ type: 'empty', content: '' }] : [];
  } else if (role === 'user') {
    // Ce que l'utilisateur a tape s'affiche tel quel : pas de reinterpretation
    // de ses asterisques ni de ses backticks (index.js:1447).
    blocks = segments
      .filter((segment) => segment.type !== 'reasoning')
      .map((segment) => ({ type: 'plain', content: segment.content.trim() }));
  } else {
    blocks = segments.map((segment) => ({
      type: segment.type === 'reasoning' ? 'reasoning' : 'text',
      content: segment.content.trim()
    }));
  }

  return {
    id: entry?.id || `msg-${index}`,
    role,
    blocks,
    timestamp: entry?.timestamp || now,
    agentLabel: buildAgentLabel(entry),
    /** Index d'origine : les actions par message (copier/relancer) de
     *  index.js sont indexees sur l'historique brut, pas sur le modele. */
    sourceIndex: index
  };
};

export const conversationToChatMessages = (history, now = 0) =>
  (Array.isArray(history) ? history : []).map((entry, index) => toChatMessage(entry, index, now));

export default conversationToChatMessages;
