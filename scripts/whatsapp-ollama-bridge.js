require('dotenv').config();
const http = require('http');
const crypto = require('crypto');
const { URL } = require('url');
const { spawn } = require('child_process');
const axios = require('axios');

const PORT = Number(process.env.WHATSAPP_BRIDGE_PORT || 3030);
const VERIFY_TOKEN = String(process.env.WHATSAPP_VERIFY_TOKEN || '').trim();
const ACCESS_TOKEN = String(process.env.WHATSAPP_ACCESS_TOKEN || '').trim();
const PHONE_NUMBER_ID = String(process.env.WHATSAPP_PHONE_NUMBER_ID || '').trim();
const GRAPH_VERSION = String(process.env.WHATSAPP_GRAPH_VERSION || 'v22.0').trim();
const OLLAMA_URL = String(process.env.OLLAMA_URL || 'http://localhost:11434').trim().replace(/\/+$/, '');
const DEFAULT_MODEL = String(process.env.WHATSAPP_OLLAMA_MODEL || 'qwen3:latest').trim() || 'qwen3:latest';
const SYSTEM_PROMPT = String(
  process.env.WHATSAPP_SYSTEM_PROMPT ||
  'Tu es un assistant technique concis. Reponds en francais avec des actions concretes.'
).trim();
const ALLOWED_NUMBERS = new Set(
  String(process.env.WHATSAPP_ALLOWED_NUMBERS || '')
    .split(',')
    .map((n) => n.trim())
    .filter(Boolean)
);
const ALLOW_ALL_SENDERS = /^(1|true|yes)$/i.test(String(process.env.WHATSAPP_ALLOW_ALL_SENDERS || '').trim());
const APP_SECRET = String(process.env.WHATSAPP_APP_SECRET || '').trim();
const DISABLE_SIGNATURE_VERIFY = /^(1|true|yes)$/i.test(String(process.env.WHATSAPP_DISABLE_SIGNATURE_VERIFY || '').trim());
const MAX_BODY_BYTES = Math.max(1024, Number(process.env.WHATSAPP_MAX_BODY_BYTES || 1024 * 1024));
const EXEC_ENABLED = /^(1|true|yes)$/i.test(String(process.env.WHATSAPP_EXEC_ENABLED || '').trim());
const EXEC_TIMEOUT_MS = Math.max(1000, Number(process.env.WHATSAPP_EXEC_TIMEOUT_MS || 30000));
const EXEC_MAX_OUTPUT = Math.max(500, Number(process.env.WHATSAPP_EXEC_MAX_OUTPUT || 3000));
const EXEC_ALLOWLIST = String(process.env.WHATSAPP_EXEC_ALLOWLIST || '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);

let runtimeModel = DEFAULT_MODEL;

const sendJson = (res, code, payload) => {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
};

const readJsonBody = (req) => new Promise((resolve, reject) => {
  const chunks = [];
  let totalBytes = 0;
  req.on('data', (chunk) => {
    totalBytes += chunk.length;
    if (totalBytes > MAX_BODY_BYTES) {
      reject(new Error(`Body trop volumineux (${totalBytes} bytes > ${MAX_BODY_BYTES})`));
      req.destroy();
      return;
    }
    chunks.push(chunk);
  });
  req.on('end', () => {
    const rawBuffer = Buffer.concat(chunks);
    const raw = rawBuffer.toString('utf8');
    if (!raw) return resolve({ body: {}, raw: rawBuffer });
    try {
      resolve({ body: JSON.parse(raw), raw: rawBuffer });
    } catch (error) {
      reject(new Error(`JSON invalide: ${error.message}`));
    }
  });
  req.on('error', reject);
});

const verifyWebhookSignature = (req, rawBody) => {
  if (DISABLE_SIGNATURE_VERIFY) return true;
  if (!APP_SECRET) return false;

  const received = String(req.headers['x-hub-signature-256'] || '').trim();
  if (!received.startsWith('sha256=')) return false;

  const expected = `sha256=${crypto
    .createHmac('sha256', APP_SECRET)
    .update(rawBody)
    .digest('hex')}`;

  const receivedBuffer = Buffer.from(received, 'utf8');
  const expectedBuffer = Buffer.from(expected, 'utf8');
  if (receivedBuffer.length !== expectedBuffer.length) return false;
  return crypto.timingSafeEqual(receivedBuffer, expectedBuffer);
};

const splitForWhatsApp = (text, maxLen = 1500) => {
  const value = String(text || '').trim();
  if (!value) return ['(reponse vide)'];
  if (value.length <= maxLen) return [value];
  const parts = [];
  for (let i = 0; i < value.length; i += maxLen) parts.push(value.slice(i, i + maxLen));
  return parts;
};

const sendWhatsAppText = async (to, text) => {
  if (!ACCESS_TOKEN || !PHONE_NUMBER_ID) {
    throw new Error('WHATSAPP_ACCESS_TOKEN et WHATSAPP_PHONE_NUMBER_ID sont requis');
  }

  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${PHONE_NUMBER_ID}/messages`;
  const chunks = splitForWhatsApp(text);
  for (const chunk of chunks) {
    await axios.post(
      url,
      {
        messaging_product: 'whatsapp',
        to,
        type: 'text',
        text: { body: chunk }
      },
      {
        timeout: 15000,
        headers: {
          Authorization: `Bearer ${ACCESS_TOKEN}`,
          'Content-Type': 'application/json'
        }
      }
    );
  }
};

const askOllama = async (prompt) => {
  const response = await axios.post(
    `${OLLAMA_URL}/api/chat`,
    {
      model: runtimeModel,
      stream: false,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: prompt }
      ]
    },
    { timeout: 120000 }
  );

  const text = String(response?.data?.message?.content || '').trim();
  if (!text) return '(aucune reponse Ollama)';
  return text;
};

const tokenizeCommand = (commandLine) => {
  const text = String(commandLine || '').trim();
  const tokens = [];
  let current = '';
  let quote = null;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quote) {
      if (ch === quote) {
        quote = null;
      } else {
        current += ch;
      }
      continue;
    }
    if (ch === '"' || ch === '\'') {
      quote = ch;
      continue;
    }
    if (/\s/.test(ch)) {
      if (current) {
        tokens.push(current);
        current = '';
      }
      continue;
    }
    current += ch;
  }
  if (quote) throw new Error('Guillemets non fermes');
  if (current) tokens.push(current);
  return tokens;
};

const isAllowedExec = (normalizedCommand) => {
  if (!EXEC_ENABLED) return false;
  if (!EXEC_ALLOWLIST.length) return false;
  return EXEC_ALLOWLIST.some((prefix) => (
    normalizedCommand === prefix || normalizedCommand.startsWith(`${prefix} `)
  ));
};

const runExecCommand = async (commandLine) => {
  const tokens = tokenizeCommand(commandLine);
  if (!tokens.length) throw new Error('Usage: /exec <commande>');

  const normalized = tokens.join(' ').trim();
  if (!isAllowedExec(normalized)) {
    throw new Error('Commande non autorisee par WHATSAPP_EXEC_ALLOWLIST');
  }

  const [bin, ...args] = tokens;
  return await new Promise((resolve, reject) => {
    const child = spawn(bin, args, {
      cwd: process.cwd(),
      shell: false,
      windowsHide: true
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let killedForSize = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, EXEC_TIMEOUT_MS);

    const append = (target, chunk) => {
      const value = target + String(chunk || '');
      if (value.length > EXEC_MAX_OUTPUT) {
        killedForSize = true;
        child.kill();
        return value.slice(0, EXEC_MAX_OUTPUT);
      }
      return value;
    };

    child.stdout.on('data', (chunk) => { stdout = append(stdout, chunk); });
    child.stderr.on('data', (chunk) => { stderr = append(stderr, chunk); });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      const status = timedOut ? `timeout (${EXEC_TIMEOUT_MS}ms)` : String(code);
      const parts = [
        `Commande: ${normalized}`,
        `Exit: ${status}`
      ];
      if (stdout.trim()) parts.push(`STDOUT:\n${stdout.trim()}`);
      if (stderr.trim()) parts.push(`STDERR:\n${stderr.trim()}`);
      if (!stdout.trim() && !stderr.trim()) parts.push('(aucune sortie)');
      if (killedForSize) parts.push('(sortie tronquee)');
      resolve(parts.join('\n\n'));
    });
  });
};

const helpMessage = () => [
  'Commandes disponibles:',
  '/help -> aide',
  '/model -> affiche le modele actif',
  '/model <nom> -> change le modele en runtime',
  '/ask <question> -> pose une question a Qwen',
  '/exec <commande> -> execute une commande locale (si active)',
  '',
  `Modele courant: ${runtimeModel}`,
  `Exec active: ${EXEC_ENABLED ? 'oui' : 'non'}`
].join('\n');

const handleCommand = async ({ from, text }) => {
  const input = String(text || '').trim();
  if (!input) return;

  if (input === '/help' || input === 'help') {
    await sendWhatsAppText(from, helpMessage());
    return;
  }

  if (input === '/model') {
    await sendWhatsAppText(from, `Modele actif: ${runtimeModel}`);
    return;
  }

  if (input.startsWith('/model ')) {
    const nextModel = input.slice('/model '.length).trim();
    if (!nextModel) {
      await sendWhatsAppText(from, 'Usage: /model qwen3:latest');
      return;
    }
    runtimeModel = nextModel;
    await sendWhatsAppText(from, `OK. Modele actif: ${runtimeModel}`);
    return;
  }

  if (input === '/exec') {
    await sendWhatsAppText(from, 'Usage: /exec <commande>');
    return;
  }

  if (input.startsWith('/exec ')) {
    const commandLine = input.slice('/exec '.length).trim();
    try {
      const result = await runExecCommand(commandLine);
      await sendWhatsAppText(from, result);
    } catch (error) {
      await sendWhatsAppText(from, `Erreur exec: ${error.message}`);
    }
    return;
  }

  const prompt = input.startsWith('/ask ') ? input.slice('/ask '.length).trim() : input;
  if (!prompt) {
    await sendWhatsAppText(from, 'Usage: /ask <question>');
    return;
  }

  try {
    const answer = await askOllama(prompt);
    await sendWhatsAppText(from, answer);
  } catch (error) {
    const message = error?.response?.data?.error || error.message;
    await sendWhatsAppText(from, `Erreur Ollama: ${message}`);
  }
};

const extractInboundMessages = (body) => {
  const list = [];
  const entries = Array.isArray(body?.entry) ? body.entry : [];
  for (const entry of entries) {
    const changes = Array.isArray(entry?.changes) ? entry.changes : [];
    for (const change of changes) {
      const value = change?.value || {};
      const messages = Array.isArray(value?.messages) ? value.messages : [];
      for (const message of messages) {
        if (message?.type !== 'text') continue;
        const from = String(message?.from || '').trim();
        const text = String(message?.text?.body || '').trim();
        if (!from || !text) continue;
        list.push({ from, text });
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

const server = http.createServer(async (req, res) => {
  const requestUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (req.method === 'GET' && requestUrl.pathname === '/health') {
    return sendJson(res, 200, {
      ok: true,
      model: runtimeModel,
      ollamaUrl: OLLAMA_URL,
      execEnabled: EXEC_ENABLED,
      execAllowlistSize: EXEC_ALLOWLIST.length,
      allowAllSenders: ALLOW_ALL_SENDERS,
      allowedNumbersSize: ALLOWED_NUMBERS.size,
      signatureRequired: !DISABLE_SIGNATURE_VERIFY,
      appSecretConfigured: !!APP_SECRET,
      maxBodyBytes: MAX_BODY_BYTES
    });
  }

  if (req.method === 'GET' && requestUrl.pathname === '/webhook') {
    const mode = requestUrl.searchParams.get('hub.mode');
    const token = requestUrl.searchParams.get('hub.verify_token');
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
    let body;
    let raw;
    try {
      const parsed = await readJsonBody(req);
      body = parsed.body;
      raw = parsed.raw;
    } catch (error) {
      return sendJson(res, 400, { ok: false, error: error.message });
    }

    if (!verifyWebhookSignature(req, raw)) {
      return sendJson(res, 403, { ok: false, error: 'signature invalide ou WHATSAPP_APP_SECRET manquant' });
    }

    sendJson(res, 200, { ok: true });

    const inbound = extractInboundMessages(body);
    for (const msg of inbound) {
      if (!isAllowedSender(msg.from)) {
        // Silent drop for unauthorized numbers.
        continue;
      }
      handleCommand(msg).catch((error) => {
        console.error('[WhatsApp Bridge] Command error:', error.message);
      });
    }
    return;
  }

  sendJson(res, 404, { ok: false, error: 'not found' });
});

server.listen(PORT, () => {
  console.log('[WhatsApp Bridge] Running');
  console.log(`[WhatsApp Bridge] http://localhost:${PORT}/health`);
  console.log(`[WhatsApp Bridge] Webhook: /webhook`);
  console.log(`[WhatsApp Bridge] Ollama: ${OLLAMA_URL}`);
  console.log(`[WhatsApp Bridge] Model: ${runtimeModel}`);
  console.log(`[WhatsApp Bridge] Allowed senders: ${ALLOW_ALL_SENDERS ? 'ALL (override)' : ALLOWED_NUMBERS.size}`);
  console.log(`[WhatsApp Bridge] Signature required: ${DISABLE_SIGNATURE_VERIFY ? 'non (override)' : 'oui'}`);
  console.log(`[WhatsApp Bridge] Exec enabled: ${EXEC_ENABLED}`);
  if (EXEC_ENABLED) {
    console.log(`[WhatsApp Bridge] Exec allowlist: ${EXEC_ALLOWLIST.join(' | ') || '(vide)'}`);
  }
});
