'use strict';
const express = require('express');
const router = express.Router();

/* Optional deps */
let multer;
try { multer = require('multer'); } catch {}
const upload = multer ? multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024 } }) : null;

/* Node18+ has fetch. If not, lazy-polyfill with node-fetch */
const fetch =
  global.fetch ||
  ((...args) => import('node-fetch').then(({ default: f }) => f(...args)));

const LOG = [];
const OPTOUT = new Map(); // tenantId -> Set(msisdn)
const RATE = new Map();   // tenantId -> { tsBucket, count }
let BAL_CACHE = { ts: 0, payload: null };

const RATE_PER_MIN = Number(process.env.SMS_RATE_PER_MIN || 60);
const ALLOW_BODY_SENDER =
  String(process.env.SMS_ALLOW_BODY_SENDERID || process.env.SMS_ALLOW_BODY_SENDER || '')
    .toLowerCase() === 'true';

const PRICE_PER_SEGMENT = Number(process.env.SMS_PRICE_PER_SEGMENT || process.env.SMS_TZS_PER_SEGMENT || 0);
const UNIT = process.env.SMS_UNIT_NAME || 'credits';

/* -------------------------------- helpers -------------------------------- */
function pick(obj, keys) {
  for (const k of keys) if (obj && obj[k] != null && String(obj[k]).trim() !== '') return obj[k];
  return undefined;
}
function countryDigits() {
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

/** Derive sender from DB — “first name of the company” (first word of org name) */
async function getSystemSenderId(req, tenantId) {
  try {
    const models = req.app?.get?.('models');
    if (!models) return null;

    // Try common places for organization/tenant name
    const candidates = [];

    if (models.Tenant?.findByPk) {
      const t = await models.Tenant.findByPk(tenantId);
      if (t) candidates.push(t.name, t.companyName, t.org_name);
      // optional JSON profile: profile.smsSenderId or profile.name
      if (t?.profile?.smsSenderId) candidates.push(t.profile.smsSenderId);
      if (t?.profile?.name) candidates.push(t.profile.name);
    }

    if (models.Organization?.findOne) {
      const org = await models.Organization.findOne({ where: { tenantId } });
      if (org) candidates.push(org.name, org.companyName);
    }

    if (models.Setting?.findOne) {
      // sometimes org name is stored as a setting
      const s = await models.Setting.findOne({ where: { tenant_id: tenantId, key: 'organization_name' } });
      if (s?.value) candidates.push(s.value);
      const s2 = await models.Setting.findOne({ where: { tenant_id: tenantId, key: 'sms_sender_id' } });
      if (s2?.value) candidates.push(s2.value);
    }

    const raw = candidates.find(v => typeof v === 'string' && v.trim());
    if (!raw) return null;

    let firstWord = raw.trim().split(/\s+/)[0] || 'ORG';
    // sanitize to A-Z0-9, uppercased, max 11 chars (sender id constraints)
    firstWord = firstWord.replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 11);
    if (firstWord.length < 3) return null;
    return firstWord;
  } catch (_) { return null; }
}

async function senderForTenant(req, tenantId, requested) {
  if (ALLOW_BODY_SENDER && requested && String(requested).trim()) {
    return String(requested).trim();
  }
  const fromDb = await getSystemSenderId(req, tenantId);
  if (fromDb) return fromDb;

  try {
    const map = JSON.parse(process.env.SMS_SENDER_MAP_JSON || '{}');
    if (tenantId && map[tenantId]) return String(map[tenantId]);
  } catch {}
  return process.env.SMS_CO_TZ_SENDER_DEFAULT || process.env.SMSCO_SENDER_ID || 'MKOPOSUITE';
}

function smsCoTzUrl(params) {
  const base = process.env.SMS_CO_TZ_API_BASE || 'https://www.sms.co.tz/api.php';
  const url = new URL(base);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  return url.toString();
}
function authParams() {
  const apiKey = process.env.SMS_CO_TZ_API_KEY || process.env.SMSCO_API_KEY || '';
  const username = process.env.SMS_CO_TZ_USERNAME || process.env.SMSCO_USERNAME || '';
  const password = process.env.SMS_CO_TZ_PASSWORD || process.env.SMSCO_PASSWORD || '';
  if (apiKey && String(apiKey).trim()) return { api_key: apiKey };
  return { username, password };
}
async function smsCoTzSend({ to, msg, senderid }) {
  const url = smsCoTzUrl({ do: 'sms', ...authParams(), senderid, dest: to, msg });
  const resp = await fetch(url);
  const text = await resp.text();
  if (!resp.ok) throw new Error(`sms.co.tz HTTP ${resp.status}: ${text}`);
  const [status, detail, idMaybe] = String(text).split(',');
  if (status?.trim().toUpperCase() === 'OK') return { ok: true, provider: 'sms.co.tz', id: idMaybe || detail, raw: text };
  return { ok: false, provider: 'sms.co.tz', error: detail || 'Unknown error', raw: text };
}
async function smsRawBalance() {
  const url = smsCoTzUrl({ do: 'balance', ...authParams() });
  const resp = await fetch(url);
  const text = await resp.text();
  if (!resp.ok) throw new Error(`balance HTTP ${resp.status}: ${text}`);
  return text;
}
async function smsCoTzBalance() {
  const now = Date.now();
  if (BAL_CACHE.payload && now - BAL_CACHE.ts < 60_000) return BAL_CACHE.payload;
  const text = await smsRawBalance();
  // Format: "OK,1827.728813559319"
  const m = /^OK,?\s*([\d.]+)/i.exec(text || '');
  const credits = m ? Number(m[1]) : null;
  const payload = credits != null
    ? {
        ok: true,
        provider: 'sms.co.tz',
        credits,
        creditsRounded: Math.round(credits * 100) / 100,
        estSegmentsLeft: PRICE_PER_SEGMENT > 0 ? Math.floor(credits / PRICE_PER_SEGMENT) : null,
        unit: UNIT,
        checkedAt: new Date().toISOString()
      }
    : { ok: false, provider: 'sms.co.tz', error: String(text || 'Unknown').slice(0, 200) };
  BAL_CACHE = { ts: now, payload };
  return payload;
}
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
  const bucket = Math.floor(now / 60_000);
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

/* ------------------------------ capabilities ------------------------------ */
router.get('/capabilities', async (req, res) => {
  const tenantId =
    req.headers['x-tenant-id'] ||
    req.body?.tenantId ||
    process.env.DEFAULT_TENANT_ID ||
    'default';
  const def = await senderForTenant(req, tenantId, null);
  res.json({ allowBodySender: ALLOW_BODY_SENDER, defaultSender: def });
});

/* --------------------------------- routes -------------------------------- */

// Parsed balance for UI
router.get('/balance', async (_req, res) => {
  try { res.json(await smsCoTzBalance()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// Single send
router.post('/send', async (req, res) => {
  try {
    const b = req.body || {};
    const to = pick(b, ['to','dest','msisdn','phone','recipient','number']);
    const message = pick(b, ['message','msg','text','body','sms']);
    const requestedFrom = pick(b, ['from','sender','senderId','senderid']);
    if (!to) return res.status(400).json({ error: 'to is required' });
    if (!message) return res.status(400).json({ error: 'message is required' });

    const tenantId = b.tenantId || req.headers['x-tenant-id'] || process.env.DEFAULT_TENANT_ID || 'default';
    if (!rateCheck(tenantId)) return res.status(429).json({ error: `rate limit exceeded (${RATE_PER_MIN}/min)` });

    const toNorm = normalizeTZ(to);
    if (isOptedOut(tenantId, toNorm)) return res.status(403).json({ error: 'recipient opted out' });

    const senderid = await senderForTenant(req, tenantId, requestedFrom);
    if (String(process.env.SMS_DRY_RUN) === '1') {
      const fakeId = Date.now().toString();
      logPush({ id: fakeId, to: toNorm, from: senderid, message: String(message), at: new Date().toISOString(), status: 'dry-run' });
      return res.json({ ok: true, provider: 'sms.co.tz', id: fakeId, raw: 'DRY_RUN' });
    }
    const result = await smsCoTzSend({ to: toNorm, msg: String(message), senderid });
    logPush({ id: result.id || Date.now(), to: toNorm, from: senderid, message: String(message), at: new Date().toISOString(), status: result.ok ? 'queued' : 'failed', raw: result.raw });
    if (!result.ok) return res.status(400).json(result);
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Quick multi-send: { to:["..."], message, from? }
router.post('/send-many', async (req, res) => {
  try {
    const { to = [], message, from, tenantId: tId } = req.body || {};
    if (!Array.isArray(to) || to.length === 0) return res.status(400).json({ error: 'to[] required' });
    if (!message) return res.status(400).json({ error: 'message is required' });

    const tenantId = tId || req.headers['x-tenant-id'] || process.env.DEFAULT_TENANT_ID || 'default';
    const senderid = await senderForTenant(req, tenantId, from);
    const results = [];

    for (const msisdn of to) {
      if (!rateCheck(tenantId)) { results.push({ ok:false, error:`rate limit exceeded` }); continue; }
      const p = normalizeTZ(msisdn);
      if (!p) { results.push({ ok:false, error:'invalid to' }); continue; }
      if (isOptedOut(tenantId, p)) { results.push({ ok:false, error:'recipient opted out' }); continue; }

      if (String(process.env.SMS_DRY_RUN) === '1') {
        const id = Date.now().toString();
        logPush({ id, to: p, from: senderid, message, at: new Date().toISOString(), status: 'dry-run' });
        results.push({ ok: true, id, raw: 'DRY_RUN' });
        continue;
      }
      try {
        const r = await smsCoTzSend({ to: p, msg: String(message), senderid });
        logPush({ id: r.id || Date.now(), to: p, from: senderid, message, at: new Date().toISOString(), status: r.ok?'queued':'failed', raw: r.raw });
        results.push(r);
      } catch (e) { results.push({ ok:false, error:e.message }); }
    }

    res.json({ ok: true, count: results.filter(r=>r.ok).length, results });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Bulk with templating
router.post('/bulk', async (req, res) => {
  try {
    const b = req.body || {};
    const template = b.template ? String(b.template) : null;
    const items = Array.isArray(b.messages) ? b.messages : [];
    if (!items.length) return res.status(400).json({ error: 'messages[] is required' });

    const tenantId = b.tenantId || req.headers['x-tenant-id'] || process.env.DEFAULT_TENANT_ID || 'default';
    const results = [];

    for (const m of items) {
      if (!rateCheck(tenantId)) { results.push({ ok:false, error:`rate limit exceeded (${RATE_PER_MIN}/min)` }); continue; }
      const toNorm = normalizeTZ(m.to || m.phone || '');
      if (!toNorm) { results.push({ ok:false, error:'invalid to' }); continue; }
      if (isOptedOut(tenantId, toNorm)) { results.push({ ok:false, error:'recipient opted out' }); continue; }

      let msg = (m.message || m.text || '').toString();
      if (template) {
        msg = template.replace(/\{\{(\w+)\}\}/g, (_s,g1) => (m.vars && g1 in m.vars ? String(m.vars[g1]) : ''));
      }
      const senderid = await senderForTenant(req, tenantId, m.from || b.defaultFrom);

      if (String(process.env.SMS_DRY_RUN) === '1') {
        const id = Date.now().toString() + Math.floor(Math.random()*1000);
        logPush({ id, to: toNorm, from: senderid, message: msg, at: new Date().toISOString(), status: 'dry-run' });
        results.push({ ok:true, id, raw:'DRY_RUN' });
        continue;
      }
      try {
        const r = await smsCoTzSend({ to: toNorm, msg, senderid });
        logPush({ id: r.id || Date.now(), to: toNorm, from: senderid, message: msg, at: new Date().toISOString(), status: r.ok?'queued':'failed', raw: r.raw });
        results.push(r);
      } catch (e) { results.push({ ok:false, error:e.message }); }
    }

    res.json({ ok: true, results });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ---------- Server-side segment: tries to honor CRM filters if models exist */
router.post('/to-segment', async (req, res) => {
  try {
    const { filter = {}, template, from } = req.body || {};
    const tenantId = req.headers['x-tenant-id'] || process.env.DEFAULT_TENANT_ID || 'default';
    const senderid = await senderForTenant(req, tenantId, from);

    const models = req.app?.get?.('models');
    const out = [];

    if (!models?.Borrower?.findAll) {
      return res.status(501).json({ ok: false, error: 'Borrower model not available' });
    }

    // Build borrower where
    const whereBorrower = {};
    if (filter.branchId) whereBorrower.branchId = filter.branchId;

    // naive search: name/phone contains q, if provided
    if (filter.q) {
      const q = String(filter.q).trim();
      whereBorrower.$or = [
        { firstName: { $iLike: `%${q}%` } },
        { lastName:  { $iLike: `%${q}%` } },
        { phone:     { $iLike: `%${q}%` } },
        { msisdn:    { $iLike: `%${q}%` } },
      ];
    }

    // If loan filters exist and Loan model is available, try to filter via raw query (kept defensive)
    let borrowerIdsLoanFiltered = null;
    if ((filter.loanStatus || filter.overdueOnly || filter.defaulted || filter.officerId) && models?.sequelize) {
      try {
        const parts = [`SELECT DISTINCT "borrowerId" FROM "Loans" WHERE 1=1`];
        const repl = {};
        if (filter.loanStatus) { parts.push(`AND "status" = :status`); repl.status = String(filter.loanStatus); }
        if (filter.officerId)  { parts.push(`AND "officerId" = :officerId`); repl.officerId = filter.officerId; }
        if (filter.overdueOnly) parts.push(`AND COALESCE("daysLate",0) > 0`);
        if (filter.defaulted)   parts.push(`AND "status" IN ('defaulted','written_off')`);
        const [rows] = await models.sequelize.query(parts.join(' '), { replacements: repl });
        borrowerIdsLoanFiltered = new Set(rows.map(r => r.borrowerId));
      } catch { /* fall back to no-op */ }
    }

    // Fetch borrowers and apply loan filter result if present
    const borrowers = await models.Borrower.findAll({
      where: whereBorrower,
      attributes: ['id','firstName','lastName','phone','msisdn','branchId'],
      limit: Math.min(Number(filter.limit || 500), 1000),
      raw: true
    });

    const targets = borrowers
      .filter(b => (borrowerIdsLoanFiltered ? borrowerIdsLoanFiltered.has(b.id) : true))
      .map(b => ({
        id: b.id,
        name: [b.firstName, b.lastName].filter(Boolean).join(' ').trim() || `Borrower ${b.id}`,
        phone: b.phone || b.msisdn || null,
        branchId: b.branchId || null
      }))
      .filter(x => x.phone);

    if (!targets.length) return res.json({ ok: true, count: 0, results: [] });

    // Send via /bulk path
    const messages = targets.map(t => {
      const [firstName, ...rest] = (t.name || '').split(' ');
      return { to: t.phone, vars: { name: t.name, firstName, lastName: rest.join(' ') }, from: senderid };
    });

    req.body = { messages, template, defaultFrom: senderid };
    return router.handle({ ...req, url: '/bulk', method: 'POST' }, res);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* ----------------------------- CSV upload -------------------------------- */
if (upload) {
  router.post('/upload-csv', upload.single('file'), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: 'file is required' });
      const text = req.file.buffer.toString('utf8').trim();
      const [headLine, ...rows] = text.split(/\r?\n/);
      const headers = headLine.split(',').map(h => h.trim().toLowerCase());
      const idx = (name) => headers.indexOf(name);

      const iPhone = idx('phone') >= 0 ? idx('phone') : idx('msisdn');
      const iMsg   = idx('message') >= 0 ? idx('message') : -1;

      if (iPhone < 0) return res.status(400).json({ error: 'CSV must include a "phone" column' });

      const template = req.body?.template ? String(req.body.template) : null;
      const messages = [];

      for (const line of rows) {
        if (!line.trim()) continue;
        const cells = line.split(',').map(c => c.replace(/^"|"$/g,'').trim());
        const phone = cells[iPhone];
        let msg = iMsg >= 0 ? cells[iMsg] : '';
        if (!msg && template) {
          msg = template.replace(/\{\{(\w+)\}\}/g, (_s, g1) => {
            const j = idx(g1.toLowerCase());
            return j >= 0 ? (cells[j] || '') : '';
          });
        }
        messages.push({ to: phone, message: msg });
      }

      req.body = { messages };
      return router.handle({ ...req, url: '/bulk', method: 'POST' }, res);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
} else {
  router.post('/upload-csv', (_req, res) => res.status(501).json({ error: 'CSV upload requires "multer" dependency' }));
}

/* --------------------------- Borrower picker ------------------------------ */
router.get('/recipients/borrowers', async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    const limit = Math.min(Number(req.query.limit || 20), 50);
    const branchId = req.query.branchId ? String(req.query.branchId) : undefined;
    const models = req.app.get('models');
    if (!models?.Borrower?.findAll) return res.json({ items: [] });

    const where = {};
    if (branchId) where.branchId = branchId;
    if (q) where.$or = [
      { firstName: { $iLike: `%${q}%` } },
      { lastName:  { $iLike: `%${q}%` } },
      { phone:     { $iLike: `%${q}%` } },
      { msisdn:    { $iLike: `%${q}%` } },
      { nationalId:{ $iLike: `%${q}%` } },
      { accountNo: { $iLike: `%${q}%` } },
    ];

    const rows = await models.Borrower.findAll({
      where,
      attributes: ['id','firstName','lastName','phone','msisdn','branchId'],
      limit,
      raw: true
    });

    const items = rows.map(b => ({
      id: b.id,
      name: [b.firstName, b.lastName].filter(Boolean).join(' ').trim() || `Borrower ${b.id}`,
      phone: b.phone || b.msisdn || null,
      branchId: b.branchId || null
    })).filter(x => x.phone);

    res.json({ items });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ------------------------------- Messages --------------------------------- */
router.get('/messages', (_req, res) => {
  res.setHeader('X-Total-Count', String(LOG.length));
  res.json({ items: LOG.slice(-100).reverse() });
});
router.get('/status/:id', async (req, res) => {
  try { res.json(await smsCoTzStatus(String(req.params.id))); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

/* ------------------------------- Opt-out ---------------------------------- */
router.get('/optout', (req, res) => {
  const tenantId = req.headers['x-tenant-id'] || 'default';
  res.json({ items: Array.from(OPTOUT.get(tenantId) || []) });
});
router.post('/optout', (req, res) => {
  const tenantId = req.headers['x-tenant-id'] || 'default';
  const msisdn = normalizeTZ(pick(req.body, ['to','msisdn','phone','number']));
  if (!msisdn) return res.status(400).json({ error: 'phone is required' });
  const set = OPTOUT.get(tenantId) || new Set(); set.add(msisdn); OPTOUT.set(tenantId, set);
  res.json({ ok: true, msisdn });
});
router.delete('/optout', (req, res) => {
  const tenantId = req.headers['x-tenant-id'] || 'default';
  const msisdn = normalizeTZ(pick(req.body, ['to','msisdn','phone','number']));
  if (!msisdn) return res.status(400).json({ error: 'phone is required' });
  const set = OPTOUT.get(tenantId) || new Set(); set.delete(msisdn); OPTOUT.set(tenantId, set);
  res.json({ ok: true, msisdn });
});

/* ----------------------------- legacy aliases ----------------------------- */
router.post('/sms/send', (req, res, next) =>
  router.handle({ ...req, url: '/send', method: 'POST' }, res, next)
);
router.post('/sms', (req, res, next) =>
  router.handle({ ...req, url: '/send', method: 'POST' }, res, next)
);

module.exports = router;
