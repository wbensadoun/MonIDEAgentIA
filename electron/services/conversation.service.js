'use strict';

const path = require('path');
const fs = require('fs').promises;
const { ensureTrustedProjectPath, assertSafePath } = require('../core/security');

// ---------------------------------------------------------------------------
// Title generation
// ---------------------------------------------------------------------------

const CONVERSATION_KEYWORDS = {
  react: 'React', javascript: 'JavaScript', css: 'CSS', html: 'HTML',
  api: 'API', bug: 'Correction Bug', erreur: 'Correction Erreur',
  optimisation: 'Optimisation', amélioration: 'Amélioration',
  création: 'Création', modification: 'Modification',
  interface: 'Interface UI', design: 'Design',
  fonction: 'Fonctionnalité', agent: 'Agent IA',
  gemini: 'Gemini API', electron: 'Electron',
  fichier: 'Gestion Fichiers', projet: 'Structure Projet'
};

const generateConversationTitle = (conversationHistory) => {
  const allText = conversationHistory
    .filter((msg) => msg.role === 'user')
    .map((msg) => msg.text)
    .join(' ')
    .toLowerCase();

  const found = Object.entries(CONVERSATION_KEYWORDS)
    .filter(([key]) => allText.includes(key))
    .map(([, label]) => label);

  return found.length > 0
    ? found.slice(0, 3).join(' - ').replace(/[^a-zA-Z0-9\s-]/g, '')
    : 'Conversation Agent IA';
};

// ---------------------------------------------------------------------------
// Service operations
// ---------------------------------------------------------------------------

const saveConversation = async (projectPath, conversationHistory) => {
  const trustedPath = await ensureTrustedProjectPath(projectPath);
  const title = generateConversationTitle(conversationHistory);
  const timestamp = new Date().toISOString().slice(0, 16).replace(/[T:]/g, '-');
  const fileName = `${timestamp}_${title}.txt`;
  const conversationsDir = path.join(trustedPath, 'conversations');
  const filePath = path.join(conversationsDir, fileName);
  assertSafePath(conversationsDir, filePath);

  await fs.mkdir(conversationsDir, { recursive: true });

  let text = `CONVERSATION AVEC L'AGENT IA\n`;
  text += `Date: ${new Date().toLocaleString('fr-FR')}\n`;
  text += `Projet: ${path.basename(trustedPath)}\n`;
  text += `${'='.repeat(60)}\n\n`;

  conversationHistory.forEach((msg) => {
    const role = msg.role === 'user' ? 'UTILISATEUR' : msg.role === 'model' ? 'AGENT IA' : 'SYSTÈME';
    text += `[${role}]\n${msg.text}\n\n${'-'.repeat(40)}\n\n`;
  });

  await fs.writeFile(filePath, text, 'utf-8');
  return { fileName, filePath };
};

const listConversations = async (projectPath) => {
  const trustedPath = await ensureTrustedProjectPath(projectPath);
  const conversationsDir = path.join(trustedPath, 'conversations');

  let entries;
  try {
    entries = await fs.readdir(conversationsDir, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }

  const conversations = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.txt')) continue;
    const filePath = path.join(conversationsDir, entry.name);
    const stats = await fs.stat(filePath);
    let title = entry.name.replace(/\.txt$/i, '');
    const idx = title.indexOf('_');
    if (idx !== -1) title = title.slice(idx + 1);
    conversations.push({ fileName: entry.name, filePath, createdAt: stats.mtime.toISOString(), title });
  }

  return conversations.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
};

const loadConversation = async (projectPath, fileName) => {
  const trustedPath = await ensureTrustedProjectPath(projectPath);
  const conversationsDir = path.join(trustedPath, 'conversations');
  const filePath = path.join(conversationsDir, fileName);
  assertSafePath(conversationsDir, filePath);

  const content = await fs.readFile(filePath, 'utf-8');
  const history = [];
  const blockRegex = /\[(UTILISATEUR|AGENT IA|SYSTÈME)\]\n([\s\S]*?)(?:\n-{40,}\n\n|$)/g;
  let match;
  while ((match = blockRegex.exec(content)) !== null) {
    const text = (match[2] || '').trim();
    if (!text) continue;
    const rawRole = match[1];
    const role = rawRole === 'UTILISATEUR' ? 'user' : rawRole === 'AGENT IA' ? 'model' : 'system';
    history.push({ role, text });
  }

  return { history, fileName };
};

module.exports = { saveConversation, listConversations, loadConversation, generateConversationTitle };
