'use strict';
const express = require('express');
const router = express.Router();

/* Use global fetch (Node 18+) or fall back to node-fetch if needed */
let fetchFn = global.fetch;
try { if (!fetchFn) fetchFn = require('node-fetch'); } catch {}

/* -------------------------- Helpers & config -------------------------- */
const PROVIDER = 'sms.co.tz';
const DEF_BASE = process.env.SMS_CO_TZ_API_BASE || 'https://www.sms.co.tz/api.php';
const DRY_RUN  = process.env.SMS_DRY_RUN === '1';

/** Resolve senderId: priority -> explicit body.from -> tenant map -> env default */
function resolveSenderId({ tenantId, from }) {
  if (from && String(from).trim()) return String(from).trim();
  try {
    const json = process.env.SMS_SENDER_MAP_JSON ? JSON.parse(process.env.SMS_SENDER_MAP_JSON) : null;
    if (json && tenantId && json[tenantId]) return String(json[tenantId]).trim();
  } catch {}
  return (
    process.env.SMS_CO_TZ_SENDER_DEFAULT ||
    process.env.SMS_SENDER_ID_DEFAULT ||
    'MkopoSuite'
  );
}

/** Normalize to E.164-like digits for TZ (provider expects 2557XXXXXXXX) */
function normalizeMsisdn(raw, cc = '255') {
  const digits = String(raw || '').replace(/\D/g, '');
  if (!digits) return null;
  if (digits.startsWith('00')) return digits.slice(2);
  if (digits.startsWith('0') && digits.length === 10) return cc + digits.slice(1);
  if (digits.length === 9) return cc + digits; // e.g. 7XXXXXXXX -> 2557XXXXXXXX
  return digits;
}

/** Very small in-memory log (last 200) */
const LOGS = [];
function logItem(it) {
  LOGS.push(it);
  if (LOGS.length > 200) LOGS.splice(0, LOGS.length - 200);
}

/** Build URL for SMS.co.tz GET API */
function buildSmsUrl({ base = DEF_BASE, apiKey, username, password, senderId, dest, msg }) {
  const p = new URLSearchParams();
  p.set('do', 'sms');
  if (apiKey) p.set('api_key', apiKey);
  else {
    p.set('username', username || '');
    p.set('password', password || '');
  }
  p.set('senderid', senderId);
  p.set('dest', dest);
  p.set('msg', msg);
  return `${base}?${p.toString()}`;
}

/** Parse provider CSV-ish responses: "OK,DETAIL,ID" or "ERR,CODE" */
function parseProviderResponse(text) {
  const parts = String(text || '').split(',');
  const status = (parts[0] || '').trim().toUpperCase();
  if (status === 'OK') {
    return { ok: true, detail: (parts[1] || '').trim(), id: (parts[2] || '').trim(), raw: text };
  }
  return { ok: false, code: (parts[1] || '').trim(), raw: text };
}

/* ----------------------------- Core send ------------------------------ */
async function sendViaSmsCoTz({ to, message, senderId, base }) {
  const apiKey   = process.env.SMS_CO_TZ_API_KEY || null;
  const username = process.env.SMS_CO_TZ_USERNAME || null;
  const password = process.env.SMS_CO_TZ_PASSWORD || null;

  if (!apiKey && !(username && password)) {
    const err = new Error('SMS provider not configured');
    err.http = 503;
    throw err;
  }

  if (DRY_RUN) {
    return { ok: true, providerId: `dryrun-${Date.now()}`, raw: 'OK,DRY_RUN', detail: 'DRY_RUN' };
  }

  const url = buildSmsUrl({ base, apiKey, username, password, senderId, dest: to, msg: message });
  const resp = await fetchFn(url, { method: 'GET' });
  if (!resp.ok) {
    const txt = await resp.text().catch(() => '');
    const err = new Error(`Provider HTTP ${resp.status} ${txt ? `- ${txt}` : ''}`);
    err.http = 502;
    throw err;
  }
  const body = await resp.text();
  const parsed = parseProviderResponse(body);
  if (!parsed.ok) {
    const err = new Error(parsed.code || 'Provider error');
    err.http = 502;
    err.providerRaw = parsed.raw;
    throw err;
  }
  return { ok: true, providerId: parsed.id || null, raw: parsed.raw, detail: parsed.detail || null };
}

/* ----------------------------- Handlers -------------------------------- */
async function handleSend(req, res) {
  try {
    const tenantId = req.context?.tenantId || req.body?.tenantId || null;
    const senderId = resolveSenderId({ tenantId, from: req.body?.from });

    // Accept "to" as string, array, or comma/space separated.
    let tos = req.body?.to;
    if (!tos) return res.status(400).json({ error: 'to is required' });
    if (!Array.isArray(tos)) {
      tos = String(tos).split(/[, \n\r\t]+/).filter(Boolean);
    }

    const message = String(req.body?.message || '').trim();
    if (!message) return res.status(400).json({ error: 'message is required' });

    const base = req.body?.providerBase || DEF_BASE;

    const results = [];
    for (const raw of tos) {
      const norm = normalizeMsisdn(raw);
      if (!norm) {
        results.push({ to: raw, ok: false, error: 'INVALIDNUMBER' });
        continue;
      }
      try {
        const r = await sendViaSmsCoTz({ to: norm, message, senderId, base });
        results.push({ to: norm, ok: true, messageId: r.providerId, detail: r.detail || undefined });
        logItem({
          id: Date.now(),
          tenantId,
          to: norm,
          from: senderId,
          message,
          at: new Date().toISOString(),
          status: 'sent',
          provider: PROVIDER,
          providerId: r.providerId || null
        });
      } catch (e) {
        results.push({ to: norm, ok: false, error: e.message });
        logItem({
          id: Date.now(),
          tenantId,
          to: norm,
          from: senderId,
          message,
          at: new Date().toISOString(),
          status: 'error',
          provider: PROVIDER,
          error: e.message
        });
      }
    }

    const ok = results.every(r => r.ok);
    return res.status(ok ? 200 : 207).json({
      ok,
      provider: PROVIDER,
      dryRun: DRY_RUN,
      senderId,
      results
    });
  } catch (e) {
    return res.status(e.http || 500).json({ error: e.message || 'send failed', provider: PROVIDER });
  }
}

async function handleBalance(_req, res) {
  try {
    // Heuristic: most gateways use do=balance; keep it best-effort.
    const apiKey   = process.env.SMS_CO_TZ_API_KEY || null;
    const username = process.env.SMS_CO_TZ_USERNAME || null;
    const password = process.env.SMS_CO_TZ_PASSWORD || null;

    if (!apiKey && !(username && password)) {
      return res.status(503).json({ error: 'SMS provider not configured' });
    }

    if (DRY_RUN) return res.json({ ok: true, provider: PROVIDER, balance: 'dry-run' });

    const base = DEF_BASE;
    const p = new URLSearchParams();
    p.set('do', 'balance');
    if (apiKey) p.set('api_key', apiKey);
    else { p.set('username', username); p.set('password', password); }

    const url = `${base}?${p.toString()}`;
    const r = await fetchFn(url, { method: 'GET' });
    const body = await r.text().catch(() => '');
    res.json({ ok: r.ok, provider: PROVIDER, raw: body });
  } catch (e) {
    res.status(502).json({ error: e.message, provider: PROVIDER });
  }
}

/* ------------------------------- Routes -------------------------------- */
// Canonical
router.post('/send', handleSend);
router.get('/logs', (_req, res) => res.json({ items: LOGS }));
router.get('/balance', handleBalance);

// Legacy aliases (work because app mounts this router under /api/communications and /api/notifications too)
router.post('/sms/send', handleSend); // -> /api/communications/sms/send
router.post('/sms', handleSend);      // -> /api/notifications/sms

// Minimal config peek (sanitized)
router.get('/config', (_req, res) => {
  res.json({
    provider: PROVIDER,
    dryRun: DRY_RUN,
    base: DEF_BASE,
    senderDefault: process.env.SMS_CO_TZ_SENDER_DEFAULT || process.env.SMS_SENDER_ID_DEFAULT || 'MkopoSuite',
    tenantSenderMap: !!process.env.SMS_SENDER_MAP_JSON
  });
});

module.exports = router;
