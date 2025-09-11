'use strict';
const express = require('express');
const router = express.Router();

/* Node18+ has fetch. If not, lazy-polyfill with node-fetch */
const fetch =
  global.fetch ||
  ((...args) => import('node-fetch').then(({ default: f }) => f(...args)));

/* ----------------------- in-memory helpers / stores ----------------------- */
const LOG = []; // recent messages
const OPTOUT = new Map(); // tenantId -> Set(msisdn)
const RATE = new Map();   // tenantId -> { tsBucket, count }
let BAL_CACHE = { ts: 0, payload: null };

const RATE_PER_MIN = Number(process.env.SMS_RATE_PER_MIN || 30);
const ALLOW_BODY_SENDER =
  String(process.env.SMS_ALLOW_BODY_SENDERID || process.env.SMS_ALLOW_BODY_SENDER || '')
    .toLowerCase() === 'true';

/* -------------------------------- utilities ------------------------------- */
function pick(obj, keys) {
  for (const k of keys) {
    if (obj && obj[k] != null && String(obj[k]).trim() !== '') return obj[k];
  }
  return undefined;
}

function countryDigits() {
  // DEFAULT_COUNTRY_CODE may be '+255' or '255'
  const cc = (process.env.DEFAULT_COUNTRY_CODE || '255').replace('+', '');
  return /^\d+$/.test(cc) ? cc : '255';
}

function normalizeTZ(phone) {
  if (!phone) return '';
  let p = String(phone).replace(/[^\d+]/g, '');
  const cc = countryDigits();

  if (p.startsWith(`+${cc}`)) p = p.slice(1);
  else if (p.startsWith('0')) p = cc + p.slice(1);
  else if (p.startsWith('+')) p = p.slice(1);
  return p;
}

function senderForTenant(tenantId, requested) {
  // honor requested ONLY if env allows (and non-empty)
  if (ALLOW_BODY_SENDER && requested && String(requested).trim())
    return String(requested).trim();

  try {
    const map = JSON.parse(process.env.SMS_SENDER_MAP_JSON || '{}');
    if (tenantId && map[tenantId]) return String(map[tenantId]);
  } catch {}

  // fallbacks (new name first, then old)
  return (
    process.env.SMS_CO_TZ_SENDER_DEFAULT ||
    process.env.SMSCO_SENDER_ID ||
    'MkopoSuite'
  );
}

function smsCoTzUrl(params) {
  const base = process.env.SMS_CO_TZ_API_BASE || 'https://www.sms.co.tz/api.php';
  const url = new URL(base);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  return url.toString();
}

function authParams() {
  // new names first
  const apiKey =
    process.env.SMS_CO_TZ_API_KEY || process.env.SMSCO_API_KEY || '';
  const username =
    process.env.SMS_CO_TZ_USERNAME || process.env.SMSCO_USERNAME || '';
  const password =
    process.env.SMS_CO_TZ_PASSWORD || process.env.SMSCO_PASSWORD || '';

  if (apiKey && String(apiKey).trim()) return { api_key: apiKey };
  return { username, password };
}

async function smsCoTzSend({ to, msg, senderid }) {
  const url = smsCoTzUrl({ do: 'sms', ...authParams(), senderid, dest: to, msg });
  const resp = await fetch(url);
  const text = await resp.text();
  if (!resp.ok) throw new Error(`sms.co.tz HTTP ${resp.status}: ${text}`);
  // provider format: "OK,1851.728813559319" or "ERR,some reason"
  const [status, detail, idMaybe] = String(text).split(',');
  if (status && status.trim().toUpperCase() === 'OK') {
    return { ok: true, provider: 'sms.co.tz', id: idMaybe || detail, raw: text };
  }
  return { ok: false, provider: 'sms.co.tz', error: detail || 'Unknown error', raw: text };
}

async function smsCoTzBalance() {
  const now = Date.now();
  if (BAL_CACHE.payload && now - BAL_CACHE.ts < 60_000) return BAL_CACHE.payload; // 60s cache
  const url = smsCoTzUrl({ do: 'balance', ...authParams() });
  const resp = await fetch(url);
  const text = await resp.text();
  if (!resp.ok) throw new Error(`balance HTTP ${resp.status}: ${text}`);
  const payload = { ok: true, provider: 'sms.co.tz', raw: text };
  BAL_CACHE = { ts: now, payload };
  return payload;
}

// Guess DLR endpoint (docs mention “lookup DLR by ID”)
async function smsCoTzStatus(id) {
  for (const key of ['dlr', 'dlr_status']) {
    const url = smsCoTzUrl({ do: key, ...authParams(), id });
    const resp = await fetch(url);
    const text = await resp.text();
    if (resp.ok) return { ok: true, provider: 'sms.co.tz', raw: text, do: key };
  }
  return { ok: false, provider: 'sms.co.tz', error: 'DLR lookup failed' };
}

function rateCheck(tenantId) {
  const now = Date.now();
  const bucket = Math.floor(now / 60_000); // per-minute bucket
  const rec = RATE.get(tenantId) || { tsBucket: bucket, count: 0 };
  if (rec.tsBucket !== bucket) { rec.tsBucket = bucket; rec.count = 0; }
  if (rec.count >= RATE_PER_MIN) return false;
  rec.count += 1;
  RATE.set(tenantId, rec);
  return true;
}

function isOptedOut(tenantId, msisdn) {
  const set = OPTOUT.get(tenantId);
  return set ? set.has(msisdn) : false;
}

function logPush(entry) {
  LOG.push(entry);
  if (LOG.length > 400) LOG.splice(0, LOG.length - 400);
}

/* --------------------------------- routes --------------------------------- */

// Balance
router.get('/balance', async (_req, res) => {
  try { res.json(await smsCoTzBalance()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// Single send (canonical)
router.post('/send', async (req, res) => {
  try {
    const b = req.body || {};
    let to = pick(b, ['to', 'dest', 'msisdn', 'phone', 'recipient', 'number']);
    let message = pick(b, ['message', 'msg', 'text', 'body', 'sms']);
    const requestedFrom = pick(b, ['from', 'sender', 'senderId', 'senderid']);

    if (!to || !String(to).trim()) return res.status(400).json({ error: 'to is required' });
    if (!message || !String(message).trim()) return res.status(400).json({ error: 'message is required' });

    const tenantId = b.tenantId || req.headers['x-tenant-id'] || process.env.DEFAULT_TENANT_ID || 'default';
    if (!rateCheck(tenantId)) return res.status(429).json({ error: `rate limit exceeded (${RATE_PER_MIN}/min)` });

    const toNorm = normalizeTZ(to);
    if (isOptedOut(tenantId, toNorm)) return res.status(403).json({ error: 'recipient opted out' });

    const senderid = senderForTenant(tenantId, requestedFrom);

    // dry run
    if (String(process.env.SMS_DRY_RUN) === '1') {
      const fakeId = Date.now().toString();
      logPush({ id: fakeId, to: toNorm, from: senderid, message: String(message), at: new Date().toISOString(), status: 'dry-run' });
      return res.json({ ok: true, provider: 'sms.co.tz', id: fakeId, raw: 'DRY_RUN' });
    }

    const result = await smsCoTzSend({ to: toNorm, msg: String(message), senderid });
    logPush({ id: result.id || Date.now(), to: toNorm, from: senderid, message: String(message), at: new Date().toISOString(), status: result.ok ? 'queued' : 'failed', raw: result.raw });
    if (!result.ok) return res.status(400).json(result);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Bulk send with simple templating
// body: { messages:[{to, message, vars, from}], template?, defaultFrom? }
router.post('/bulk', async (req, res) => {
  try {
    const b = req.body || {};
    const template = b.template ? String(b.template) : null;
    const items = Array.isArray(b.messages) ? b.messages : [];
    if (!items.length) return res.status(400).json({ error: 'messages[] is required' });

    const tenantId = b.tenantId || req.headers['x-tenant-id'] || process.env.DEFAULT_TENANT_ID || 'default';
    const results = [];

    for (const m of items) {
      if (!rateCheck(tenantId)) {
        results.push({ ok: false, error: `rate limit exceeded (${RATE_PER_MIN}/min)` });
        continue;
      }

      const toNorm = normalizeTZ(m.to || m.phone || '');
      if (!toNorm) { results.push({ ok: false, error: 'invalid to' }); continue; }
      if (isOptedOut(tenantId, toNorm)) { results.push({ ok: false, error: 'recipient opted out' }); continue; }

      let msg = (m.message || m.text || '').toString();
      if (template) {
        msg = template.replace(/\{\{(\w+)\}\}/g, (_s, g1) => (m.vars && g1 in m.vars ? String(m.vars[g1]) : ''));
      }

      const senderid = senderForTenant(tenantId, m.from || b.defaultFrom);
      if (String(process.env.SMS_DRY_RUN) === '1') {
        const id = Date.now().toString() + Math.floor(Math.random() * 1000);
        logPush({ id, to: toNorm, from: senderid, message: msg, at: new Date().toISOString(), status: 'dry-run' });
        results.push({ ok: true, id, raw: 'DRY_RUN' });
        continue;
      }

      try {
        const r = await smsCoTzSend({ to: toNorm, msg, senderid });
        logPush({ id: r.id || Date.now(), to: toNorm, from: senderid, message: msg, at: new Date().toISOString(), status: r.ok ? 'queued' : 'failed', raw: r.raw });
        results.push(r);
      } catch (e) {
        results.push({ ok: false, error: e.message });
      }
    }

    res.json({ ok: true, results });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Messages log
router.get('/messages', (_req, res) => {
  res.setHeader('X-Total-Count', String(LOG.length));
  res.json({ items: LOG.slice(-100).reverse() });
});

// Status lookup (DLR)
router.get('/status/:id', async (req, res) => {
  try { res.json(await smsCoTzStatus(String(req.params.id))); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// Opt-out management (per tenant)
router.get('/optout', (req, res) => {
  const tenantId = req.headers['x-tenant-id'] || 'default';
  res.json({ items: Array.from(OPTOUT.get(tenantId) || []) });
});
router.post('/optout', (req, res) => {
  const tenantId = req.headers['x-tenant-id'] || 'default';
  const msisdn = normalizeTZ(pick(req.body, ['to', 'msisdn', 'phone', 'number']));
  if (!msisdn) return res.status(400).json({ error: 'phone is required' });
  const set = OPTOUT.get(tenantId) || new Set();
  set.add(msisdn); OPTOUT.set(tenantId, set);
  res.json({ ok: true, msisdn });
});
router.delete('/optout', (req, res) => {
  const tenantId = req.headers['x-tenant-id'] || 'default';
  const msisdn = normalizeTZ(pick(req.body, ['to', 'msisdn', 'phone', 'number']));
  if (!msisdn) return res.status(400).json({ error: 'phone is required' });
  const set = OPTOUT.get(tenantId) || new Set();
  set.delete(msisdn); OPTOUT.set(tenantId, set);
  res.json({ ok: true, msisdn });
});

/* ====================== EXTRA: send to borrowers / by segment ====================== */
// POST /api/sms/to-borrowers  { borrowerIds:[...], template:"Hi {{name}}", from? }
router.post('/to-borrowers', async (req, res) => {
  try {
    const { borrowerIds, template, from } = req.body || {};
    if (!Array.isArray(borrowerIds) || borrowerIds.length === 0) {
      return res.status(400).json({ error: 'borrowerIds[] required' });
    }
    if (!template || !String(template).trim()) {
      return res.status(400).json({ error: 'template is required' });
    }

    const models = req.app.get('models');
    if (!models?.Borrower?.findAll) {
      return res.json({ ok: true, count: 0, note: 'Borrower model missing; nothing sent.' });
    }

    const borrowers = await models.Borrower.findAll({
      where: { id: borrowerIds },
      attributes: ['id', 'firstName', 'lastName', 'phone', 'msisdn', 'branchId'],
      raw: true
    });

    const tenantId = req.headers['x-tenant-id'] || req.body?.tenantId || process.env.DEFAULT_TENANT_ID || 'default';
    const results = [];

    for (const b of borrowers) {
      const to = normalizeTZ(b.phone || b.msisdn || '');
      if (!to) continue;
      if (!rateCheck(tenantId)) { results.push({ ok:false, error:`rate limit exceeded` }); continue; }
      if (isOptedOut(tenantId, to)) { results.push({ ok:false, error:'recipient opted out' }); continue; }

      const name = (b.firstName ? `${b.firstName} ${b.lastName||''}`.trim() : '').trim();
      const msg = String(template).replace(/\{\{(\w+)\}\}/g, (_s, g1) => {
        if (g1 === 'name') return name || 'Borrower';
        if (g1 === 'firstName') return b.firstName || '';
        if (g1 === 'lastName') return b.lastName || '';
        return '';
      });

      const senderid = senderForTenant(tenantId, from);
      if (String(process.env.SMS_DRY_RUN) === '1') {
        const id = Date.now().toString() + Math.floor(Math.random()*1000);
        logPush({ id, to, from: senderid, message: msg, at: new Date().toISOString(), status: 'dry-run' });
        results.push({ ok: true, id, raw: 'DRY_RUN' });
        continue;
      }
      try {
        const r = await smsCoTzSend({ to, msg, senderid });
        logPush({ id: r.id || Date.now(), to, from: senderid, message: msg, at: new Date().toISOString(), status: r.ok?'queued':'failed', raw: r.raw });
        results.push(r);
      } catch (e) {
        results.push({ ok:false, error:e.message });
      }
    }

    res.json({ ok: true, count: results.filter(x=>x.ok).length, results });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/sms/to-segment  { filter:{branchId?, hasActiveLoan?, overdueOnly?}, template, from? }
router.post('/to-segment', async (req, res) => {
  try {
    const { filter = {}, template, from } = req.body || {};
    if (!template || !String(template).trim()) {
      return res.status(400).json({ error: 'template is required' });
    }

    const models = req.app.get('models');
    if (!models?.Borrower?.findAll) {
      return res.json({ ok: true, count: 0, note: 'Borrower model missing; nothing sent.' });
    }

    const where = {};
    if (filter.branchId) where.branchId = filter.branchId;

    let borrowers = await models.Borrower.findAll({
      where,
      attributes: ['id','firstName','lastName','phone','msisdn','branchId'],
      raw: true
    });

    if (filter.hasActiveLoan && models?.Loan?.findAll) {
      const ids = borrowers.map(b=>b.id);
      const activeLoans = await models.Loan.findAll({
        attributes: ['borrowerId','status','dueDate'],
        where: { borrowerId: ids },
        raw: true
      });
      const activeMap = new Map();
      const overdueMap = new Map();
      const now = new Date();

      activeLoans.forEach(l => {
        const active = String(l.status || '').toLowerCase() === 'active';
        if (active) activeMap.set(l.borrowerId, true);
        if (active && l.dueDate && new Date(l.dueDate) < now) overdueMap.set(l.borrowerId, true);
      });

      borrowers = borrowers.filter(b => activeMap.get(b.id));
      if (filter.overdueOnly) borrowers = borrowers.filter(b => overdueMap.get(b.id));
    }

    const tenantId = req.headers['x-tenant-id'] || process.env.DEFAULT_TENANT_ID || 'default';
    let sent = 0;

    for (const b of borrowers) {
      const to = normalizeTZ(b.phone || b.msisdn || '');
      if (!to) continue;
      if (!rateCheck(tenantId)) break;
      if (isOptedOut(tenantId, to)) continue;

      const name = (b.firstName ? `${b.firstName} ${b.lastName||''}`.trim() : '').trim();
      const msg = String(template).replace(/\{\{(\w+)\}\}/g, (_s, g1) => {
        if (g1 === 'name') return name || 'Borrower';
        if (g1 === 'firstName') return b.firstName || '';
        if (g1 === 'lastName') return b.lastName || '';
        return '';
      });
      const senderid = senderForTenant(tenantId, from);

      if (String(process.env.SMS_DRY_RUN) === '1') {
        const id = Date.now().toString() + Math.floor(Math.random()*1000);
        logPush({ id, to, from: senderid, message: msg, at: new Date().toISOString(), status: 'dry-run' });
        sent++; continue;
      }
      try {
        const r = await smsCoTzSend({ to, msg, senderid });
        logPush({ id: r.id || Date.now(), to, from: senderid, message: msg, at: new Date().toISOString(), status: r.ok?'queued':'failed', raw: r.raw });
        if (r.ok) sent++;
      } catch {}
    }

    res.json({ ok: true, count: sent });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* ---------------------------- legacy compat paths -------------------------- */
// When mounted at /api/communications and /api/notifications
router.post('/sms/send', (req, res, next) =>
  router.handle({ ...req, url: '/send', method: 'POST' }, res, next)
);
router.post('/sms', (req, res, next) =>
  router.handle({ ...req, url: '/send', method: 'POST' }, res, next)
);

module.exports = router;
