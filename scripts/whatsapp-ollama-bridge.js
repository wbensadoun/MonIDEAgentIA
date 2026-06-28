require('dotenv').config();
const http = require('http');
const crypto = require('crypto');
const { URL } = require('url');
const { spawn } = require('child_process');
const axios = require('axios');

// ─── Config ─────────────────────────────────────────────────────────────────
const PORT             = Number(process.env.WHATSAPP_BRIDGE_PORT || 3030);
const VERIFY_TOKEN     = String(process.env.WHATSAPP_VERIFY_TOKEN || '').trim();
const ACCESS_TOKEN     = String(process.env.WHATSAPP_ACCESS_TOKEN || '').trim();
const PHONE_NUMBER_ID  = String(process.env.WHATSAPP_PHONE_NUMBER_ID || '').trim();
const GRAPH_VERSION    = String(process.env.WHATSAPP_GRAPH_VERSION || 'v22.0').trim();
const APP_SECRET       = String(process.env.WHATSAPP_APP_SECRET || '').trim();
const DISABLE_SIGNATURE_VERIFY = /^(1|true|yes)$/i.test(String(process.env.WHATSAPP_DISABLE_SIGNATURE_VERIFY || '').trim());
const MAX_BODY_BYTES   = Math.max(1024, Number(process.env.WHATSAPP_MAX_BODY_BYTES || 1024 * 1024));
const ALLOWED_NUMBERS  = new Set(
  String(process.env.WHATSAPP_ALLOWED_NUMBERS || '').split(',').map((n) => n.trim()).filter(Boolean)
);
const ALLOW_ALL_SENDERS = /^(1|true|yes)$/i.test(String(process.env.WHATSAPP_ALLOW_ALL_SENDERS || '').trim());

// IDE taskServer
const IDE_URL        = String(process.env.IDE_TASK_URL || 'http://127.0.0.1:3001').trim();
const IDE_API_TOKEN  = String(process.env.IDE_API_TOKEN || '').trim();

// /exec legacy (conservé, optionnel)
const EXEC_ENABLED   = /^(1|true|yes)$/i.test(String(process.env.WHATSAPP_EXEC_ENABLED || '').trim());
const EXEC_TIMEOUT_MS  = Math.max(1000, Number(process.env.WHATSAPP_EXEC_TIMEOUT_MS || 30000));
const EXEC_MAX_OUTPUT  = Math.max(500, Number(process.env.WHATSAPP_EXEC_MAX_OUTPUT || 3000));
const EXEC_ALLOWLIST   = String(process.env.WHATSAPP_EXEC_ALLOWLIST || '')
  .split(',').map((v) => v.trim()).filter(Boolean);

// ─── État par numéro ─────────────────────────────────────────────────────────
// state: 'IDLE' | 'WORKING' | 'AWAITING_APPROVAL'
const senderState = new Map(); // sender → { state, autopilot }

function getState(sender) {
  if (!senderState.has(sender)) senderState.set(sender, { state: 'IDLE', autopilot: false });
  return senderState.get(sender);
}

// ─── Déduplication (évite que Meta rejoue le même webhook) ──────────────────
const seenMessageIds = new Set();
const SEEN_MAX = 500; // évite croissance infinie

function isDuplicate(msgId) {
  if (!msgId) return false;
  if (seenMessageIds.has(msgId)) return true;
  seenMessageIds.add(msgId);
  if (seenMessageIds.size > SEEN_MAX) {
    // Purge la moitié la plus ancienne
    const arr = [...seenMessageIds];
    for (let i = 0; i < SEEN_MAX / 2; i++) seenMessageIds.delete(arr[i]);
  }
  return false;
}

// ─── Helpers HTTP / WhatsApp ─────────────────────────────────────────────────
const sendJson = (res, code, payload) => {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
};

const readJsonBody = (req) => new Promise((resolve, reject) => {
  const chunks = [];
  let totalBytes = 0;
  req.on('data', (chunk) => {
    totalBytes += chunk.length;
    if (totalBytes > MAX_BODY_BYTES) { reject(new Error(`Body trop volumineux`)); req.destroy(); return; }
    chunks.push(chunk);
  });
  req.on('end', () => {
    const rawBuffer = Buffer.concat(chunks);
    const raw = rawBuffer.toString('utf8');
    if (!raw) return resolve({ body: {}, raw: rawBuffer });
    try { resolve({ body: JSON.parse(raw), raw: rawBuffer }); }
    catch (e) { reject(new Error(`JSON invalide: ${e.message}`)); }
  });
  req.on('error', reject);
});

const verifyWebhookSignature = (req, rawBody) => {
  if (DISABLE_SIGNATURE_VERIFY) return true;
  if (!APP_SECRET) return false;
  const received = String(req.headers['x-hub-signature-256'] || '').trim();
  if (!received.startsWith('sha256=')) return false;
  const expected = `sha256=${crypto.createHmac('sha256', APP_SECRET).update(rawBody).digest('hex')}`;
  const rb = Buffer.from(received, 'utf8'), eb = Buffer.from(expected, 'utf8');
  if (rb.length !== eb.length) return false;
  return crypto.timingSafeEqual(rb, eb);
};

const splitForWhatsApp = (text, maxLen = 1500) => {
  const value = String(text || '').trim();
  if (!value) return ['(réponse vide)'];
  if (value.length <= maxLen) return [value];
  const parts = [];
  for (let i = 0; i < value.length; i += maxLen) parts.push(value.slice(i, i + maxLen));
  return parts;
};

const sendWhatsAppText = async (to, text) => {
  if (!ACCESS_TOKEN || !PHONE_NUMBER_ID) {
    console.warn('[Bridge] sendWhatsAppText: WHATSAPP_ACCESS_TOKEN ou PHONE_NUMBER_ID manquant');
    return;
  }
  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${PHONE_NUMBER_ID}/messages`;
  for (const chunk of splitForWhatsApp(text)) {
    await axios.post(url,
      { messaging_product: 'whatsapp', to, type: 'text', text: { body: chunk } },
      { timeout: 15000, headers: { Authorization: `Bearer ${ACCESS_TOKEN}`, 'Content-Type': 'application/json' } }
    );
  }
};

// ─── Appel vers l'IDE ────────────────────────────────────────────────────────
const askIDE = async (prompt, sender, autopilot) => {
  const headers = { 'Content-Type': 'application/json' };
  if (IDE_API_TOKEN) headers['Authorization'] = `Bearer ${IDE_API_TOKEN}`;

  const resp = await axios.post(
    `${IDE_URL}/task`,
    { prompt, sender, autopilot: !!autopilot },
    { headers, timeout: 600000 } // 10 min : les tâches longues prennent du temps sur iMac 2011
  );
  return String(resp.data?.response || '(pas de réponse)');
};

const notifyApprove = async (sender, answer) => {
  const headers = { 'Content-Type': 'application/json' };
  if (IDE_API_TOKEN) headers['Authorization'] = `Bearer ${IDE_API_TOKEN}`;
  try {
    await axios.post(`${IDE_URL}/approve`, { sender, answer }, { headers, timeout: 10000 });
  } catch (e) {
    console.error('[Bridge] /approve error:', e.message);
  }
};

// ─── /exec legacy ────────────────────────────────────────────────────────────
const tokenizeCommand = (commandLine) => {
  const text = String(commandLine || '').trim();
  const tokens = [];
  let current = '', quote = null;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quote) { if (ch === quote) { quote = null; } else { current += ch; } continue; }
    if (ch === '"' || ch === "'") { quote = ch; continue; }
    if (/\s/.test(ch)) { if (current) { tokens.push(current); current = ''; } continue; }
    current += ch;
  }
  if (quote) throw new Error('Guillemets non fermés');
  if (current) tokens.push(current);
  return tokens;
};

const isAllowedExec = (normalized) => {
  if (!EXEC_ENABLED || !EXEC_ALLOWLIST.length) return false;
  return EXEC_ALLOWLIST.some((p) => normalized === p || normalized.startsWith(`${p} `));
};

const runExecCommand = (commandLine) => {
  const tokens = tokenizeCommand(commandLine);
  if (!tokens.length) throw new Error('Usage: /exec <commande>');
  const normalized = tokens.join(' ').trim();
  if (!isAllowedExec(normalized)) throw new Error('Commande non autorisée par WHATSAPP_EXEC_ALLOWLIST');
  const [bin, ...args] = tokens;
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { cwd: process.cwd(), shell: false, windowsHide: true });
    let stdout = '', stderr = '', timedOut = false, killedForSize = false;
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, EXEC_TIMEOUT_MS);
    const append = (t, c) => {
      const v = t + String(c || '');
      if (v.length > EXEC_MAX_OUTPUT) { killedForSize = true; child.kill(); return v.slice(0, EXEC_MAX_OUTPUT); }
      return v;
    };
    child.stdout.on('data', (c) => { stdout = append(stdout, c); });
    child.stderr.on('data', (c) => { stderr = append(stderr, c); });
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('close', (code) => {
      clearTimeout(timer);
      const parts = [`Commande: ${normalized}`, `Exit: ${timedOut ? `timeout (${EXEC_TIMEOUT_MS}ms)` : code}`];
      if (stdout.trim()) parts.push(`STDOUT:\n${stdout.trim()}`);
      if (stderr.trim()) parts.push(`STDERR:\n${stderr.trim()}`);
      if (!stdout.trim() && !stderr.trim()) parts.push('(aucune sortie)');
      if (killedForSize) parts.push('(sortie tronquée)');
      resolve(parts.join('\n\n'));
    });
  });
};

// ─── Help ────────────────────────────────────────────────────────────────────
const helpMessage = (autopilot) => [
  '🤖 *Mon IDE Agent IA — Commandes disponibles*',
  '',
  '*Tâches (langage naturel)*',
  'Exemple: "Pour le Projet 67, crée un bouton sur la page d\'accueil"',
  '',
  '*Commandes de contrôle*',
  '/help → cette aide',
  '/reset → effacer la mémoire de conversation',
  `/autopilot ${autopilot ? 'off' : 'on'} → ${autopilot ? 'désactiver' : 'activer'} le mode autopilot`,
  '',
  '*Mode autopilot*',
  `État actuel : ${autopilot ? '✅ ON (toutes commandes auto, sauf dangereuses)' : '⏸️ OFF (demande accord avant commandes hors-liste)'}`,
  '',
  EXEC_ENABLED ? `/exec <commande> → exécuter une commande locale` : null,
].filter(Boolean).join('\n');

// ─── Gestionnaire de message entrant ─────────────────────────────────────────
const handleMessage = async ({ from, text, msgId }) => {
  const input = String(text || '').trim();
  if (!input) return;

  // Déduplication
  if (isDuplicate(msgId)) {
    console.log(`[Bridge] Message dupliqué ignoré: ${msgId}`);
    return;
  }

  const st = getState(from);

  // ── État AWAITING_APPROVAL : OUI/NON attendu ─────────────────────────────
  if (st.state === 'AWAITING_APPROVAL') {
    if (/^(oui|yes|ok|1|y)$/i.test(input)) {
      st.state = 'IDLE';
      await notifyApprove(from, 'oui');
      await sendWhatsAppText(from, '✅ Commande autorisée. L\'agent continue...');
    } else if (/^(non|no|0|n)$/i.test(input)) {
      st.state = 'IDLE';
      await notifyApprove(from, 'non');
      await sendWhatsAppText(from, '🚫 Commande refusée.');
    } else {
      await sendWhatsAppText(from, '⏳ En attente de ta réponse : réponds *OUI* ou *NON*.');
    }
    return;
  }

  // ── État WORKING : tâche en cours ───────────────────────────────────────
  if (st.state === 'WORKING') {
    await sendWhatsAppText(from, '⏳ Une tâche est déjà en cours. Patiente encore un peu...');
    return;
  }

  // ── IDLE : traitement normal ─────────────────────────────────────────────

  if (input === '/help' || input === 'help') {
    await sendWhatsAppText(from, helpMessage(st.autopilot));
    return;
  }

  if (input === '/reset') {
    const headers = { 'Content-Type': 'application/json' };
    if (IDE_API_TOKEN) headers['Authorization'] = `Bearer ${IDE_API_TOKEN}`;
    try {
      await axios.post(`${IDE_URL}/task`, { prompt: '', sender: from, reset: true }, { headers, timeout: 10000 });
    } catch {}
    await sendWhatsAppText(from, '🔄 Conversation réinitialisée.');
    return;
  }

  if (input === '/autopilot on') {
    st.autopilot = true;
    await sendWhatsAppText(from, '✅ Autopilot activé — l\'agent exécutera les commandes sans demander (sauf celles dangereuses).');
    return;
  }
  if (input === '/autopilot off') {
    st.autopilot = false;
    await sendWhatsAppText(from, '⏸️ Autopilot désactivé — l\'agent demandera ta permission avant chaque commande hors-liste.');
    return;
  }

  if (input === '/exec') {
    await sendWhatsAppText(from, 'Usage: /exec <commande>');
    return;
  }
  if (input.startsWith('/exec ')) {
    if (!EXEC_ENABLED) { await sendWhatsAppText(from, '❌ /exec non activé.'); return; }
    try {
      const result = await runExecCommand(input.slice('/exec '.length).trim());
      await sendWhatsAppText(from, result);
    } catch (e) {
      await sendWhatsAppText(from, `Erreur exec: ${e.message}`);
    }
    return;
  }

  // Tout le reste → tâche pour l'IDE
  st.state = 'WORKING';
  await sendWhatsAppText(from, '⏳ Je traite ta demande, ça peut prendre quelques minutes...');

  try {
    const answer = await askIDE(input, from, st.autopilot);
    st.state = 'IDLE';
    await sendWhatsAppText(from, answer);
  } catch (error) {
    st.state = 'IDLE';
    const msg = error?.response?.data?.error || error.message || 'Erreur inconnue';
    console.error('[Bridge] askIDE error:', msg);
    await sendWhatsAppText(from, `❌ Erreur : ${msg}`);
  }
};

// ─── Extraction des messages entrants ────────────────────────────────────────
const extractInboundMessages = (body) => {
  const list = [];
  for (const entry of (body?.entry || [])) {
    for (const change of (entry?.changes || [])) {
      const value = change?.value || {};
      for (const message of (value?.messages || [])) {
        const from  = String(message?.from || '').trim();
        const msgId = String(message?.id || '').trim();
        if (!from) continue;
        if (message?.type !== 'text') {
          // Message non-texte : réponse polie au lieu de silence
          list.push({ from, text: null, msgId, nonText: true, type: message?.type || 'inconnu' });
          continue;
        }
        const text = String(message?.text?.body || '').trim();
        if (!text) continue;
        list.push({ from, text, msgId, nonText: false });
      }
    }
  }
  return list;
};

const isAllowedSender = (from) => {
  if (ALLOW_ALL_SENDERS) return true;
  if (ALLOWED_NUMBERS.size === 0) return false;
  return ALLOWED_NUMBERS.has(String(from).trim());
};

// ─── Serveur HTTP ─────────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  const requestUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (req.method === 'GET' && requestUrl.pathname === '/health') {
    return sendJson(res, 200, {
      ok: true,
      ideUrl: IDE_URL,
      ideTokenConfigured: !!IDE_API_TOKEN,
      execEnabled: EXEC_ENABLED,
      allowAllSenders: ALLOW_ALL_SENDERS,
      allowedNumbersSize: ALLOWED_NUMBERS.size,
      signatureRequired: !DISABLE_SIGNATURE_VERIFY,
    });
  }

  if (req.method === 'GET' && requestUrl.pathname === '/webhook') {
    const mode      = requestUrl.searchParams.get('hub.mode');
    const token     = requestUrl.searchParams.get('hub.verify_token');
    const challenge = requestUrl.searchParams.get('hub.challenge');
    if (mode === 'subscribe' && token && token === VERIFY_TOKEN) {
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(challenge || '');
      return;
    }
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('forbidden');
    return;
  }

  if (req.method === 'POST' && requestUrl.pathname === '/webhook') {
    let body, raw;
    try {
      const parsed = await readJsonBody(req);
      body = parsed.body;
      raw  = parsed.raw;
    } catch (error) {
      return sendJson(res, 400, { ok: false, error: error.message });
    }

    if (!verifyWebhookSignature(req, raw)) {
      return sendJson(res, 403, { ok: false, error: 'signature invalide ou WHATSAPP_APP_SECRET manquant' });
    }

    // ACK immédiat à Meta (règle des 5 secondes)
    sendJson(res, 200, { ok: true });

    const inbound = extractInboundMessages(body);
    for (const msg of inbound) {
      if (!isAllowedSender(msg.from)) continue; // drop silencieux

      if (msg.nonText) {
        // Répondre aux messages non-texte (vocaux, images, etc.)
        sendWhatsAppText(msg.from, `Je ne gère que les messages texte pour l'instant. Envoie-moi ton instruction par écrit 🙂`)
          .catch((e) => console.error('[Bridge] nonText reply error:', e.message));
        continue;
      }

      handleMessage(msg).catch((error) => {
        console.error('[Bridge] handleMessage error:', error.message);
      });
    }
    return;
  }

  sendJson(res, 404, { ok: false, error: 'not found' });
});

server.listen(PORT, () => {
  console.log('[WhatsApp Bridge] Running');
  console.log(`[WhatsApp Bridge] http://localhost:${PORT}/health`);
  console.log(`[WhatsApp Bridge] IDE: ${IDE_URL} (token: ${IDE_API_TOKEN ? 'configuré' : 'NON CONFIGURÉ'})`);
  console.log(`[WhatsApp Bridge] Allowed senders: ${ALLOW_ALL_SENDERS ? 'ALL (override)' : ALLOWED_NUMBERS.size}`);
  console.log(`[WhatsApp Bridge] Signature required: ${DISABLE_SIGNATURE_VERIFY ? 'non (override)' : 'oui'}`);
  console.log(`[WhatsApp Bridge] Exec enabled: ${EXEC_ENABLED}`);
});
