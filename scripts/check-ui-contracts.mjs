#!/usr/bin/env node

/**
 * UI contract regression gate.
 *
 * This is intentionally a regression gate, not a claim that the legacy UI is
 * already clean. The baselines are the audited values for the current tree;
 * each migration can lower them, but a new violation fails CI.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceRoot = path.join(repoRoot, 'client', 'src');
const sourceExtensions = new Set(['.js', '.jsx', '.ts', '.tsx']);
const excluded = /\.(test|spec)\.[^.]+$/;

// Baselines from the current post-migration tree (2026-09-04). Keep these
// numbers in source so a baseline change is reviewed alongside the code and
// CI configuration.
const budgets = {
  buttonsWithoutType: 41,
  nativeDialogs: 3,
  nonSemanticClickTargets: 11,
  nativeTitleAttributes: 132,
};

function collectSourceFiles(directory) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectSourceFiles(fullPath));
      continue;
    }
    if (sourceExtensions.has(path.extname(entry.name)) && !excluded.test(entry.name)) {
      files.push(fullPath);
    }
  }
  return files;
}

function openingTags(source, elementName) {
  const tags = [];
  const startPattern = new RegExp(`<${elementName}\\b`, 'g');
  let match;

  while ((match = startPattern.exec(source)) !== null) {
    let index = match.index + match[0].length;
    let braces = 0;
    let quote = null;

    for (; index < source.length; index += 1) {
      const character = source[index];
      if (quote) {
        if (character === quote && source[index - 1] !== '\\') quote = null;
        continue;
      }
      if (character === '"' || character === "'") {
        quote = character;
      } else if (character === '{') {
        braces += 1;
      } else if (character === '}') {
        braces = Math.max(0, braces - 1);
      } else if (character === '>' && braces === 0) {
        tags.push(source.slice(match.index, index + 1));
        startPattern.lastIndex = index + 1;
        break;
      }
    }
  }

  return tags;
}

function hasAttribute(tag, attribute) {
  return new RegExp(`(?:^|\\s)${attribute}\\s*=`, 'u').test(tag);
}

const files = collectSourceFiles(sourceRoot);
const source = files.map((file) => fs.readFileSync(file, 'utf8')).join('\n');
const buttons = openingTags(source, 'button');
const clickableNonSemantic = [...openingTags(source, 'div'), ...openingTags(source, 'span')]
  .filter((tag) => hasAttribute(tag, 'onClick'))
  .filter((tag) => !hasAttribute(tag, 'role') && !hasAttribute(tag, 'tabIndex'));

const counts = {
  buttons: buttons.length,
  buttonsWithoutType: buttons.filter((tag) => !hasAttribute(tag, 'type')).length,
  nativeDialogs: (source.match(/window\.(?:prompt|confirm|alert)\s*\(/g) ?? []).length,
  nonSemanticClickTargets: clickableNonSemantic.length,
  nativeTitleAttributes: (source.match(/\btitle\s*=/g) ?? []).length,
};

console.log(`UI contract check (${files.length} source files, tests excluded)`);
console.log(`  buttons:                    ${counts.buttons}`);
console.log(`  buttons without type:       ${counts.buttonsWithoutType}/${budgets.buttonsWithoutType}`);
console.log(`  native dialogs:             ${counts.nativeDialogs}/${budgets.nativeDialogs}`);
console.log(`  non-semantic click targets: ${counts.nonSemanticClickTargets}/${budgets.nonSemanticClickTargets}`);
console.log(`  native title attributes:    ${counts.nativeTitleAttributes}/${budgets.nativeTitleAttributes}`);

const failures = Object.entries(budgets)
  .filter(([metric, budget]) => counts[metric] > budget)
  .map(([metric, budget]) => `${metric}=${counts[metric]} exceeds budget ${budget}`);

if (failures.length > 0) {
  console.error(`FAIL: UI contract debt increased: ${failures.join('; ')}`);
  process.exitCode = 1;
} else {
  console.log('OK: UI contract debt is non-regressive.');
}
