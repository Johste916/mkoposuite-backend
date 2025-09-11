'use strict';
const express = require('express');

const router = express.Router();

// keep very small in-memory log so Recent Messages UI has something
const LOG = [];

// ----- helpers -----
function pick(obj, keys) {
  for (const k of keys) if (obj?.[k] != null && String(obj[k]).trim() !== '') return obj[k];
  return undefined;
}

function normalizeTZ(phone) {
  if (!phone) return '';
  let p = String(phone).replace(/[^\d+]/g, '');
  if (p.startsWith('+255')) p = p.slice(1);          // '+2557…' -> '2557…'
  else if (p.startsWith('0')) p = '255' + p.slice(1); // '07…' -> '2557…'
  else if (p.startsWith('+')) p = p.slice(1);         // '+…' -> '…'
  return p;
}

function senderForTenant(tenantId) {
  try {
    const map = JSON.parse(process.env.SMS_SENDER_MAP_JSON || '{}');
    if (tenantId && map[tenantId]) return String(map[tenantId]);
  } catch {}
  return process.env.SMS_CO_TZ_SENDER_DEFAULT || 'MkopoSuite';
}

function smsCoTzUrl(params) {
  const base = process.env.SMS_CO_TZ_API_BASE || 'https://www.sms.co.tz/api.php';
  const url = new URL(base);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  return url.toString();
}

async function smsCoTzSend({ to, msg, senderid }) {
  const apiKey = process.env.SMS_CO_TZ_API_KEY;
  const username = process.env.SMS_CO_TZ_USERNAME;
  const password = process.env.SMS_CO_TZ_PASSWORD;

  const qs = { do: 'sms', senderid, dest: to, msg };

  if (apiKey && String(apiKey).trim() !== '') qs.api_key = apiKey;
  else {
    qs.username = username || '';
    qs.password = password || '';
  }

  const url = smsCoTzUrl(qs);
  const resp = await fetch(url);
  const text = await resp.text(); // e.g. "OK,123456789" or "ERR,REASON"
  if (!resp.ok) throw new Error(`sms.co.tz HTTP ${resp.status}: ${text}`);

  const [status, detail, idMaybe] = String(text).split(',');
  if (status?.trim() === 'OK') {
    return { ok: true, provider: 'sms.co.tz', id: idMaybe || detail, raw: text };
  }
  return { ok: false, provider: 'sms.co.tz', error: detail || 'Unknown error', raw: text };
}

async function smsCoTzBalance() {
  const apiKey = process.env.SMS_CO_TZ_API_KEY;
  const username = process.env.SMS_CO_TZ_USERNAME;
  const password = process.env.SMS_CO_TZ_PASSWORD;

  const qs = { do: 'balance' };
  if (apiKey && String(apiKey).trim() !== '') qs.api_key = apiKey;
  else {
    qs.username = username || '';
    qs.password = password || '';
  }

  const url = smsCoTzUrl(qs);
  const resp = await fetch(url);
  const text = await resp.text(); // "OK,1851.72…"
  if (!resp.ok) throw new Error(`balance HTTP ${resp.status}: ${text}`);

  return { ok: true, provider: 'sms.co.tz', raw: text };
}

// ----- routes -----

// GET /api/sms/balance
router.get('/balance', async (_req, res) => {
  try {
    const out = await smsCoTzBalance();
    return res.json(out);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// POST /api/sms/send
router.post('/send', async (req, res) => {
  try {
    const b = req.body || {};

    // accept many common shapes from old UIs
    let to = pick(b, ['to', 'dest', 'msisdn', 'phone', 'recipient', 'number']);
    let message = pick(b, ['message', 'msg', 'text', 'body', 'sms']);
    let from = pick(b, ['from', 'sender', 'senderId', 'senderid']);

    // try querystring too (just in case)
    if (!to) to = pick(req.query, ['to', 'dest', 'msisdn', 'phone']);
    if (!message) message = pick(req.query, ['message', 'msg', 'text', 'body']);
    if (!from) from = pick(req.query, ['from', 'sender', 'senderId']);

    // allow arrays, take first
    if (Array.isArray(to)) to = to[0];
    if (Array.isArray(message)) message = message[0];

    // validation
    if (!to || !String(to).trim()) return res.status(400).json({ error: 'to is required' });
    if (!message || !String(message).trim()) return res.status(400).json({ error: 'message is required' });

    // normalize TZ number
    const toNorm = normalizeTZ(to);

    const tenantId = b.tenantId || req.headers['x-tenant-id'] || process.env.DEFAULT_TENANT_ID || null;
    const senderid = from || senderForTenant(tenantId);

    // dry-run for testing
    if (String(process.env.SMS_DRY_RUN) === '1') {
      const fake = { ok: true, provider: 'sms.co.tz', id: Date.now(), raw: 'DRY_RUN' };
      LOG.push({ id: fake.id, to: toNorm, from: senderid, message, at: new Date().toISOString(), status: 'dry-run' });
      return res.json(fake);
    }

    const result = await smsCoTzSend({ to: toNorm, msg: String(message), senderid });

    // keep a short rolling log
    LOG.push({
      id: result.id || Date.now(),
      to: toNorm,
      from: senderid,
      message: String(message),
      at: new Date().toISOString(),
      status: result.ok ? 'queued' : 'failed',
      raw: result.raw
    });
    if (LOG.length > 200) LOG.splice(0, LOG.length - 200);

    if (!result.ok) return res.status(400).json(result);
    return res.json(result);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// GET /api/sms/messages  (used by your UI)
router.get('/messages', (_req, res) => {
  res.setHeader('X-Total-Count', String(LOG.length));
  return res.json({ items: LOG.slice(-100).reverse() });
});

// also export for mounting
module.exports = router;
