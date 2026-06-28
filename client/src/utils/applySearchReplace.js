/**
 * applySearchReplace.js
 *
 * Applicateur tolérant de blocs SEARCH/REPLACE.
 *
 * Format attendu :
 *   FILE: chemin/fichier.ext          ← optionnel, ignoré ici (géré par l'appelant)
 *   <<<< SEARCH
 *   <texte existant exact à trouver>
 *   ====
 *   <nouveau texte>
 *   >>>> REPLACE
 *
 * Stratégie de matching (dans l'ordre) :
 *   1. Exact (octet pour octet, après normalisation CRLF→LF)
 *   2. Tolérant : trim de chaque ligne + normalisation espaces internes
 *   3. Refus si >1 occurrence (ambigu)
 *   4. Refus avec message si introuvable
 */

// ─── Normalisation CRLF → LF ───────────────────────────────────────────────
function normalizeLF(str) {
  return str.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

// ─── Clé de tolérance pour une ligne ──────────────────────────────────────
// Trim + effondrement des espaces internes multiples
function tolerantKey(line) {
  return line.trim().replace(/\s+/g, ' ');
}

// ─── Comptage des occurrences d'une sous-chaîne ───────────────────────────
function countOccurrences(haystack, needle) {
  if (needle === '') return 0;
  let count = 0;
  let idx = 0;
  while ((idx = haystack.indexOf(needle, idx)) !== -1) {
    count++;
    idx += needle.length;
  }
  return count;
}

/**
 * Applique un seul bloc SEARCH/REPLACE sur `content`.
 *
 * @param {string} content   - Contenu actuel du fichier (chaîne brute)
 * @param {string} search    - Bloc à trouver (tel que produit par l'IA)
 * @param {string} replace   - Bloc de remplacement
 * @returns {{ ok: boolean, content: string, error: string|null, matchType: 'exact'|'tolerant'|null }}
 */
function applyBlock(content, search, replace) {
  const src = normalizeLF(content);
  const needle = normalizeLF(search);
  const replacement = normalizeLF(replace);

  // ── 1. Match exact ──────────────────────────────────────────────────────
  const exactCount = countOccurrences(src, needle);
  if (exactCount === 1) {
    return {
      ok: true,
      content: src.replace(needle, replacement),
      error: null,
      matchType: 'exact',
    };
  }
  if (exactCount > 1) {
    return {
      ok: false,
      content,
      error: `Bloc SEARCH ambigu : ${exactCount} occurrences identiques trouvées. Précisez un contexte plus large.`,
      matchType: null,
    };
  }

  // ── 2. Match tolérant ───────────────────────────────────────────────────
  // Construire une version "clé de tolérance" ligne par ligne
  const srcLines = src.split('\n');
  const needleLines = needle.split('\n');

  // Supprimer les lignes vides en début/fin du bloc needle (l'IA les ajoute souvent)
  let needleStart = 0;
  let needleEnd = needleLines.length - 1;
  while (needleStart <= needleEnd && needleLines[needleStart].trim() === '') needleStart++;
  while (needleEnd >= needleStart && needleLines[needleEnd].trim() === '') needleEnd--;
  const trimmedNeedle = needleLines.slice(needleStart, needleEnd + 1);

  if (trimmedNeedle.length === 0) {
    return {
      ok: false,
      content,
      error: 'Bloc SEARCH vide — impossible d\'appliquer.',
      matchType: null,
    };
  }

  const needleKeys = trimmedNeedle.map(tolerantKey);
  const windowSize = trimmedNeedle.length;

  const matchingStarts = [];

  for (let i = 0; i <= srcLines.length - windowSize; i++) {
    let match = true;
    for (let j = 0; j < windowSize; j++) {
      if (tolerantKey(srcLines[i + j]) !== needleKeys[j]) {
        match = false;
        break;
      }
    }
    if (match) matchingStarts.push(i);
  }

  if (matchingStarts.length > 1) {
    return {
      ok: false,
      content,
      error: `Bloc SEARCH ambigu (matching tolérant) : ${matchingStarts.length} zones correspondent. Précisez un contexte plus large.`,
      matchType: null,
    };
  }

  if (matchingStarts.length === 1) {
    const start = matchingStarts[0];
    const replacementLines = replacement.split('\n');
    const newLines = [
      ...srcLines.slice(0, start),
      ...replacementLines,
      ...srcLines.slice(start + windowSize),
    ];
    return {
      ok: true,
      content: newLines.join('\n'),
      error: null,
      matchType: 'tolerant',
    };
  }

  // ── 3. Introuvable ──────────────────────────────────────────────────────
  return {
    ok: false,
    content,
    error: 'Bloc SEARCH introuvable dans le fichier (ni exact, ni tolérant). Vérifiez que le texte correspond au contenu actuel du fichier.',
    matchType: null,
  };
}

/**
 * Parse et applique une liste de blocs SEARCH/REPLACE sur `content`.
 *
 * Supporte plusieurs blocs dans la même réponse IA.
 *
 * @param {string} content  - Contenu actuel du fichier
 * @param {string} aiOutput - Sortie brute de l'IA (peut contenir plusieurs blocs)
 * @returns {{ ok: boolean, content: string, errors: string[], appliedCount: number }}
 */
function applyBlocks(content, aiOutput) {
  const blocks = parseBlocks(aiOutput);

  if (blocks.length === 0) {
    return {
      ok: false,
      content,
      errors: ['Aucun bloc SEARCH/REPLACE trouvé dans la réponse.'],
      appliedCount: 0,
    };
  }

  let current = content;
  const errors = [];
  let appliedCount = 0;

  for (const block of blocks) {
    const result = applyBlock(current, block.search, block.replace);
    if (result.ok) {
      current = result.content;
      appliedCount++;
    } else {
      errors.push(result.error);
    }
  }

  return {
    ok: errors.length === 0,
    content: current,
    errors,
    appliedCount,
  };
}

/**
 * Parse les blocs SEARCH/REPLACE depuis la sortie brute de l'IA.
 *
 * Formats acceptés :
 *   <<<< SEARCH ... ==== ... >>>> REPLACE
 *   <<<< SEARCH ... ======== ... >>>> REPLACE   (variante avec plus de =)
 *
 * @param {string} text
 * @returns {{ search: string, replace: string }[]}
 */
function parseBlocks(text) {
  const normalized = normalizeLF(text);
  const blocks = [];

  // Regex souple : accepte variantes de délimiteurs (====, ========, etc.)
  const BLOCK_RE = /<<<+\s*SEARCH\s*\n([\s\S]*?)\n=+\s*\n([\s\S]*?)\n>>>+\s*REPLACE/g;

  let m;
  while ((m = BLOCK_RE.exec(normalized)) !== null) {
    blocks.push({
      search: m[1],
      replace: m[2],
    });
  }

  return blocks;
}

module.exports = { applyBlock, applyBlocks, parseBlocks, normalizeLF };
