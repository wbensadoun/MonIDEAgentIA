// Streaming-response parsing — extracted from AIChat/index.js (plan-refonte-ui-90j.md
// §5.6 / R6: "Les regex (FILE_BLOCK_STREAM_REGEX, <think>…) sont de la logique metier :
// les extraire ... avec tests avant de toucher au rendu.")
//
// Pure functions only — no React, no component state, no side effects beyond
// reading the strings they're given. This is what lets a future chat-panel
// refactor (branching components/AIChat/ChatInterface.tsx into production,
// plan §1.4) swap the render layer without also having to re-derive how the
// live token stream is parsed into file drafts, workflow drafts and
// reasoning segments — that logic is unchanged and covered by
// streamParsing.test.js regardless of which component consumes it.

export const THINKING_MESSAGES = ['Réflexion', 'Analyse', 'Évaluation', 'Examen', 'Travail en cours'];
export const TERMINAL_MESSAGES = ['Exécution', 'Traitement'];

export const WORKFLOW_STREAM_REGEX = /\*\*WORKFLOW:/i;
export const DIFF_STREAM_REGEX = /<<<<\s*SEARCH/i;
export const FILE_STREAM_REGEX = /(?:^|\n)FILE:\s*.+/i;
export const FILE_BLOCK_STREAM_REGEX = /\*\*FICHIER:\s*(.+?)\*\*\s*```([\w-]*)?\s*([\s\S]*?)(?:```|$)/gi;
export const WORKFLOW_BLOCK_STREAM_REGEX = /\*\*WORKFLOW:\s*(.+?)\*\*\s*```(?:json)?\s*([\s\S]*?)(?:```|$)/gi;
export const FILE_HEADER_STREAM_REGEX = /\*\*FICHIER:\s*(.+?)\*\*/gi;

export const WORKFLOW_STREAM_STEPS = [
  { key: 'analysis', label: 'Analyse du besoin', detail: 'Lecture du prompt et extraction des actions' },
  { key: 'nodes', label: 'Creation des noeuds', detail: 'Placement trigger, actions et sorties' },
  { key: 'links', label: 'Cablage des liens', detail: 'Connexion des transitions entre etapes' },
  { key: 'checks', label: 'Verification', detail: 'Controle de coherence du flux' },
  { key: 'final', label: 'Finalisation', detail: 'Workflow pret pour import visuel' }
];

/**
 * Returns the LAST match of `regex` in `text` (streaming text keeps
 * appending, so the most recent block is the one still being written).
 * A fresh RegExp is built from `regex.source/flags` on every call so a
 * shared `g`-flagged constant never leaks `lastIndex` state between calls.
 */
export const extractLastStreamingMatch = (regex, text) => {
  if (!text) return null;
  const safeText = String(text);
  const nextRegex = new RegExp(regex.source, regex.flags);
  let lastMatch = null;
  let match;
  while ((match = nextRegex.exec(safeText)) !== null) {
    lastMatch = match;
    if (match.index === nextRegex.lastIndex) {
      nextRegex.lastIndex += 1;
    }
  }
  return lastMatch;
};

export const extractStreamingFileDraft = (text) => {
  const match = extractLastStreamingMatch(FILE_BLOCK_STREAM_REGEX, text);
  if (!match) return null;
  return {
    filePath: String(match[1] || '').trim(),
    language: String(match[2] || '').trim(),
    code: String(match[3] || '').replace(/^\s*\n/, '')
  };
};

// Liste tous les fichiers cités dans le stream pour l'affichage live.
// Le dernier est en cours d'écriture, les précédents sont écrits.
export const extractStreamingFiles = (text) => {
  if (!text) return [];
  const re = new RegExp(FILE_HEADER_STREAM_REGEX.source, FILE_HEADER_STREAM_REGEX.flags);
  const paths = [];
  let m;
  while ((m = re.exec(text)) !== null) {
    const p = String(m[1] || '').trim();
    if (p && paths[paths.length - 1] !== p) paths.push(p);
  }
  return paths.map((p, i) => ({ path: p, status: i === paths.length - 1 ? 'writing' : 'done' }));
};

// Normalisation miroir de sanitizeProposedFilePath (useAIPendingChanges.js:32)
// pour pouvoir rapprocher un marqueur **FICHIER:** d'une entrée pendingFileChanges.
export const normalizeMarkerPath = (value) => String(value || '')
  .trim()
  .replace(/\\/g, '/')
  .split('/')
  .map((segment) => segment.trim())
  .filter(Boolean)
  .join('/');

// Miroir front de stripThinkBlocks() (electron/services/ollama.service.js).
// Couvre <think> ET <thinking>, bloc fermé ou non — un flux coupé en plein
// raisonnement laisse la balise ouverte, et l'ancien filtre (paire complète
// uniquement) laissait alors tout le raisonnement à l'écran.
export const REASONING_BLOCK_REGEX = /<(?:think|thinking)>[\s\S]*?<\/(?:think|thinking)>\n*/gi;
export const REASONING_OPEN_REGEX = /<(?:think|thinking)>[\s\S]*$/i;

export const stripReasoningBlocks = (text) => {
  if (!text) return '';
  return String(text)
    .replace(REASONING_BLOCK_REGEX, '')
    .replace(REASONING_OPEN_REGEX, '')
    .trim();
};

// Découpe un message en segments raisonnement / réponse. Le backend ne laisse
// les balises que si le mode Raisonnement est actif (sinon il a déjà strippé),
// donc ce parseur donne le bon résultat dans les deux cas sans avoir à
// connaître le réglage. Le bloc non fermé (génération coupée) est capturé
// aussi, sinon il repartirait en texte visible.
export const REASONING_SEGMENT_REGEX = /<(?:think|thinking)>([\s\S]*?)(?:<\/(?:think|thinking)>|$)/gi;

export const splitReasoningSegments = (text) => {
  const source = String(text || '');
  if (!source) return [];

  const segments = [];
  const regex = new RegExp(REASONING_SEGMENT_REGEX.source, REASONING_SEGMENT_REGEX.flags);
  let cursor = 0;
  let match;

  while ((match = regex.exec(source)) !== null) {
    if (match.index > cursor) {
      segments.push({ type: 'text', content: source.slice(cursor, match.index) });
    }
    segments.push({ type: 'reasoning', content: match[1] });
    cursor = match.index + match[0].length;
    if (match.index === regex.lastIndex) regex.lastIndex += 1;
  }
  if (cursor < source.length) {
    segments.push({ type: 'text', content: source.slice(cursor) });
  }

  return segments.filter((segment) => segment.content.trim());
};

export const extractStreamingWorkflowDraft = (text) => {
  const match = extractLastStreamingMatch(WORKFLOW_BLOCK_STREAM_REGEX, text);
  if (!match) return null;
  return {
    name: String(match[1] || '').trim(),
    json: String(match[2] || '').replace(/^\s*\n/, '')
  };
};

// Inverse of AutonomyControls' toLegacyPermission() adapter — lets the
// legacy read_only/edit_only/edit_terminal permissionMode prop (the real
// source of truth read by useFileOperations/useAIPendingChanges) drive the
// new restricted/normal/permissive AutonomyControls UI without introducing
// a second, disconnected state.
export const fromLegacyPermission = (mode) => {
  if (mode === 'read_only') return 'restricted';
  if (mode === 'edit_only') return 'normal';
  return 'permissive'; // edit_terminal (and default)
};
