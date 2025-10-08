'use strict';

const express = require('express');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');

const app = express();

/* ------------------------------- Optional env ------------------------------ */
try {
  // Load .env if present (no-op if module missing)
  require('dotenv').config();
} catch {}

/* ------------------------------ Optional deps ------------------------------ */
let helmet, compression, morgan, rateLimit;
try { helmet = require('helmet'); } catch {}
try { compression = require('compression'); } catch {}
try { morgan = require('morgan'); } catch {}
try { rateLimit = require('express-rate-limit'); } catch {}

/* ---------------------------- App base settings ---------------------------- */
app.disable('x-powered-by');
app.set('trust proxy', true);

/* -------------------------- Attach models for controllers ------------------ */
let models;
try { models = require('./models'); } catch { try { models = require('../models'); } catch {} }

if (models) {
  app.set('models', models);

  // Quick sanity: DB + critical env for auth/signup
  (async () => {
    try {
      if (models.sequelize?.authenticate) {
        await models.sequelize.authenticate();
        console.log('✅ DB connected');
      }
    } catch (e) {
      console.warn('⚠️ DB connect failed:', e.message);
    }
    if (!process.env.JWT_SECRET) {
      console.warn('⚠️ JWT_SECRET is missing. Login/Signup tokens will fail.');
    }
    if (process.env.SELF_SIGNUP_ENABLED !== '1') {
      console.warn('ℹ️ SELF_SIGNUP_ENABLED not set to 1 — public /api/signup may be disabled.');
    }
  })();
} else {
  console.warn('[BOOT] Sequelize models not found; some routes may fallback to memory. Signup will not persist.');
}

/* (optional) quick debug for models list — enable with DEBUG_API=1 */
if (process.env.DEBUG_API === '1') {
  app.get('/api/debug/models', (_req, res) => {
    const keys = models ? Object.keys(models).filter(k => !['sequelize', 'Sequelize'].includes(k)).sort() : [];
    res.json({ loaded: !!models, keys });
  });
}

/* ------------------------------- App context ------------------------------- */
app.use((req, res, next) => {
  const reqId = req.headers['x-request-id'] || (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()));
  req.id = reqId;
  res.setHeader('X-Request-Id', reqId);

  req.context = {
    tenantId: req.headers['x-tenant-id'] || null,
    branchId: req.headers['x-branch-id'] || null,
    tz: req.headers['x-timezone'] || (Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'),
    tzOffset: req.headers['x-tz-offset'] || null,
  };
  next();
});

/* -------------------------- Security & performance ------------------------- */
if (helmet) {
  app.use(helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  }));
}
if (compression) app.use(compression());
if (process.env.NODE_ENV !== 'production' && morgan) app.use(morgan('dev'));

if (rateLimit) {
  app.use('/api/', rateLimit({
    windowMs: 60 * 1000,
    max: Number(process.env.RATE_LIMIT_MAX || 120),
    standardHeaders: true,
    legacyHeaders: false,
  }));
}

/* ----------------------------------- CORS ---------------------------------- */
const defaultOrigins = [
  'http://localhost:5173', 'http://127.0.0.1:5173',
  'http://localhost:4173', 'http://127.0.0.1:4173',
  'http://localhost:3000', 'http://127.0.0.1:3000',
  'https://strong-fudge-7fc28d.netlify.app', 'https://mkoposuite.netlify.app',
];
const envOrigins = [
  ...(process.env.CORS_ALLOW_ORIGINS || process.env.CORS_ORIGINS || '')
    .split(',').map(s => s.trim()).filter(Boolean),
  ...(process.env.FRONTEND_URL ? [process.env.FRONTEND_URL.trim()] : []),
];
const allowedOrigins = new Set([...defaultOrigins, ...envOrigins]);

function isAllowedOrigin(origin) {
  if (!origin) return false;
  if (allowedOrigins.has(origin)) return true;
  try {
    const { hostname, protocol } = new URL(origin);
    if ((protocol === 'https:' || protocol === 'http:') && hostname.endsWith('.netlify.app')) return true;
  } catch {}
  return false;
}

const DEFAULT_ALLOWED_HEADERS = [
  'Content-Type', 'Authorization', 'X-Requested-With', 'X-User-Id',
  'x-tenant-id', 'x-branch-id', 'x-timezone', 'x-tz-offset', 'x-request-id', 'Accept',
];

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && isAllowedOrigin(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  }
  res.setHeader('Vary', 'Origin, Access-Control-Request-Headers');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');

  const requested = req.headers['access-control-request-headers'];
  res.setHeader(
    'Access-Control-Allow-Headers',
    requested && String(requested).trim().length ? requested : DEFAULT_ALLOWED_HEADERS.join(', ')
  );

  res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition,X-Total-Count,X-Request-Id');

  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

/* --------------------------------- Parsers --------------------------------- */
/** 🔐 Raw body capture for gateway/webhook signature verification */
function rawBodySaver(req, _res, buf) {
  if (buf && buf.length) {
    // Keep both Buffer and utf8 for flexibility
    req.rawBody = buf;
    try { req.rawBodyText = buf.toString('utf8'); } catch {}
  }
}

// Use verify to preserve rawBody for JSON & urlencoded payloads
app.use(express.json({ limit: '20mb', verify: rawBodySaver }));
app.use(express.urlencoded({ extended: true, limit: '20mb', verify: rawBodySaver }));

/* ----------------------------- Static /uploads ----------------------------- */
const uploadsDir = path.resolve(__dirname, '../uploads');
try { fs.mkdirSync(uploadsDir, { recursive: true }); } catch {}
app.use('/uploads', express.static(uploadsDir, {
  maxAge: process.env.UPLOADS_MAX_AGE || '1d',
  setHeaders: (res) => res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin'),
}));

/* -------------------------- Small response helpers ------------------------- */
app.use((_req, res, next) => {
  res.ok = (data, extra = {}) => {
    if (typeof extra.total === 'number') res.setHeader('X-Total-Count', String(extra.total));
    if (extra.filename) res.setHeader('Content-Disposition', `attachment; filename="${extra.filename}"`);
    return res.json(data);
  };
  res.fail = (status, message, extra = {}) => res.status(status).json({ error: message, ...extra });
  next();
});

/* ------------------------ Helpers: safe route loading ---------------------- */
const FORCE_REAL = process.env.REAL_DATA === '1' || process.env.FORCE_REAL_ROUTES === '1';

function makeDummyRouter(sample) {
  const r = express.Router();
  r.get('/', (_req, res) => {
    if (Array.isArray(sample)) {
      res.setHeader('X-Total-Count', String(sample.length));
      return res.json(sample);
    }
    return res.json(sample);
  });
  r.get('/:id', (req, res) => {
    const id = String(req.params.id);
    if (Array.isArray(sample)) {
      const found = sample.find(x => String(x.id) === id) || null;
      return res.json(found);
    }
    return res.json(sample);
  });
  r.post('/', (req, res) => res.status(201).json({ ...req.body, id: Date.now() }));
  r.put('/:id', (req, res) => res.json({ id: req.params.id, ...req.body }));
  r.delete('/:id', (_req, res) => res.status(204).end());
  return r;
}

function safeLoadRoutes(relPathFromSrc, dummyRouter) {
  const tryPaths = [relPathFromSrc, relPathFromSrc.replace('./', '../')];
  for (const p of tryPaths) {
    try {
      const mod = require(p);
      return mod && mod.default ? mod.default : mod;
    } catch (e) {
      if (e.code !== 'MODULE_NOT_FOUND') {
        console.warn(`⚠️  Failed loading ${p}: ${e.message}`);
        if (FORCE_REAL) throw e;
      }
    }
  }
  if (FORCE_REAL) throw new Error(`Real route required but missing: ${relPathFromSrc}`);
  console.warn(`⚠️  Using dummy routes for ${relPathFromSrc} — create this file to enable real API.`);
  return dummyRouter;
}

/* ✅ Helper: prefer first existing router path, with fallback */
function safeLoadFirst(paths, dummyRouter) {
  for (const p of paths) {
    try {
      const mod = require(p);
      return mod && mod.default ? mod.default : mod;
    } catch (e) {
      if (e.code !== 'MODULE_NOT_FOUND') {
        console.warn(`⚠️  Failed loading ${p}: ${e.message}`);
        if (FORCE_REAL) throw e;
      }
    }
  }
  console.warn(`⚠️  Using dummy routes for [${paths.join(', ')}] — create one of these files to enable real API.`);
  return dummyRouter;
}

/* --------------------- Shared in-memory stores for fallbacks --------------- */
const SUPPORT_STORE = { TICKETS: new Map(), nextId: 1 };
const SMS_LOGS = [];

/* Alias: /api/tickets/:id/comments → Support store */
const ticketsCommentsAlias = express.Router();
ticketsCommentsAlias.get('/:id/comments', (req, res) => {
  const t = SUPPORT_STORE.TICKETS.get(String(req.params.id));
  if (!t) return res.status(404).json({ error: 'Ticket not found' });
  res.json({ items: t.messages || [] });
});
ticketsCommentsAlias.post('/:id/comments', (req, res) => {
  const t = SUPPORT_STORE.TICKETS.get(String(req.params.id));
  if (!t) return res.status(404).json({ error: 'Ticket not found' });
  const b = req.body || {};
  t.messages.push({
    from: b.from || 'support',
    body: String(b.body || ''),
    at: new Date().toISOString(),
  });
  t.updatedAt = new Date().toISOString();
  res.json({ ok: true });
});

/* ---------- Fallback tenants router (in-memory; keeps UI working) ---------- */
function makeTenantsFallbackRouter() {
  const r = express.Router();
  const MEM = new Map();

  function ensureSeed() {
    if (MEM.size) return;
    const now = new Date().toISOString();
    const demo = [
      {
        id: '11111111-1111-1111-1111-111111111111',
        name: 'Acme Finance',
        status: 'active',
        plan_code: 'pro',
        trial_ends_at: null,
        auto_disable_overdue: false,
        grace_days: 7,
        billing_email: 'billing@acme.test',
        seats: 15,
        staff_count: 7,
        created_at: now,
        updated_at: now,
      },
      {
        id: '22222222-2222-2222-2222-222222222222',
        name: 'Beta Microcredit',
        status: 'trial',
        plan_code: 'basic',
        trial_ends_at: new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10),
        auto_disable_overdue: false,
        grace_days: 7,
        billing_email: 'accounts@beta.test',
        seats: 5,
        staff_count: 3,
        created_at: now,
        updated_at: now,
      },
    ];
    demo.forEach(t => MEM.set(t.id, t));
  }

  function memTenant(id) {
    ensureSeed();
    if (!id) id = process.env.DEFAULT_TENANT_ID || '00000000-0000-0000-0000-000000000000';
    if (!MEM.has(id)) {
      const now = new Date().toISOString();
      MEM.set(id, {
        id,
        name: 'Organization',
        status: 'trial',
        plan_code: 'basic',
        trial_ends_at: null,
        auto_disable_overdue: false,
        grace_days: 7,
        billing_email: '',
        seats: null,
        staff_count: null,
        created_at: now,
        updated_at: now,
      });
    }
    return MEM.get(id);
  }

  const toApi = (t) => {
    const today = new Date().toISOString().slice(0, 10);
    const trialLeft = t.trial_ends_at ? Math.ceil((Date.parse(t.trial_ends_at) - Date.parse(today)) / 86400000) : null;
    return {
      id: t.id,
      name: t.name,
      status: t.status,
      planCode: (t.plan_code || 'basic').toLowerCase(),
      planLabel: (t.plan_code || 'basic').toLowerCase(),
      trialEndsAt: t.trial_ends_at,
      trialDaysLeft: trialLeft,
      autoDisableOverdue: !!t.auto_disable_overdue,
      graceDays: t.grace_days,
      billingEmail: t.billing_email,
      seats: t.seats ?? null,
      staffCount: t.staff_count ?? null,
      createdAt: t.created_at,
      updatedAt: t.updated_at,
    };
  };

  r.get('/', (_req, res) => {
    ensureSeed();
    const list = Array.from(MEM.values()).map(toApi);
    res.setHeader('X-Total-Count', String(list.length));
    res.json(list);
  });

  r.get('/me', (req, res) => {
    const id = req.headers['x-tenant-id'] || process.env.DEFAULT_TENANT_ID || '00000000-0000-0000-0000-000000000000';
    res.json(toApi(memTenant(id)));
  });

  r.patch('/me', (req, res) => {
    const id = req.headers['x-tenant-id'] || process.env.DEFAULT_TENANT_ID || '00000000-0000-0000-0000-000000000000';
    const t = memTenant(id);
    const b = req.body || {};
    if (typeof b.name === 'string') t.name = b.name.trim();
    if (typeof b.planCode === 'string') t.plan_code = b.planCode.toLowerCase();
    if (typeof b.status === 'string') t.status = b.status.trim();
    if (b.trialEndsAt === '' || b.trialEndsAt === null) t.trial_ends_at = null;
    else if (typeof b.trialEndsAt === 'string') t.trial_ends_at = b.trialEndsAt.slice(0, 10);
    if (typeof b.autoDisableOverdue === 'boolean') t.auto_disable_overdue = b.autoDisableOverdue;
    if (!Number.isNaN(Number(b.graceDays))) t.grace_days = Math.max(0, Math.min(90, Number(b.graceDays)));
    if (typeof b.billingEmail === 'string') t.billing_email = b.billingEmail.trim();
    if ('seats' in b && (b.seats === null || Number.isFinite(Number(b.seats)))) t.seats = b.seats === null ? null : Number(b.seats);
    t.updated_at = new Date().toISOString();
    res.json({ ok: true, tenant: toApi(t) });
  });

  r.get('/:id', (req, res) => {
    const t = memTenant(String(req.params.id));
    res.json(toApi(t));
  });

  r.patch('/:id', (req, res) => {
    const t = memTenant(String(req.params.id));
    const b = req.body || {};
    if (typeof b.planCode === 'string') t.plan_code = b.planCode.toLowerCase();
    if ('seats' in b && (b.seats === null || Number.isFinite(Number(b.seats)))) t.seats = b.seats === null ? null : Number(b.seats);
    if (typeof b.billingEmail === 'string') t.billing_email = b.billingEmail.trim();
    if ('trialEndsAt' in b) t.trial_ends_at = b.trialEndsAt ? String(b.trialEndsAt).slice(0, 10) : null;
    if (typeof b.status === 'string') t.status = b.status.trim().toLowerCase();
    t.updated_at = new Date().toISOString();
    res.json({ ok: true, tenant: toApi(t) });
  });

  r.get('/stats', (_req, res) => {
    ensureSeed();
    const arr = Array.from(MEM.values()).map(t => ({
      id: t.id,
      staffCount: t.staff_count ?? 0,
      seats: t.seats ?? null,
    }));
    res.json({ items: arr });
  });

  r.get('/:id/invoices', (_req, res) => res.json({ invoices: [] }));
  r.post('/:id/invoices/sync', (_req, res) => res.json({ ok: true }));

  r.get('/me/entitlements', (_req, res) => {
    res.json({
      modules: {
        savings: true, loans: true, collections: true, accounting: true,
        sms: true, esignatures: false, payroll: false,
        investors: true, assets: true, collateral: true,
        support: true, impersonation: true, billingByPhone: true, enrichment: true,
      },
      planCode: 'basic',
      status: 'trial',
    });
  });

  r.post('/admin/billing/cron-check', (_req, res) => res.json({ ok: true }));
  return r;
}

/* -------- Tenants compat shim: special endpoints (stats/invoices/subscription) */
const IMP_STATE = { tenantId: null, startedAt: null, by: null };
function makeTenantsCompatRouter() {
  const r = express.Router();
  r.get('/stats', (_req, res) => res.json({ items: [] }));
  r.get('/:id/invoices', (_req, res) => res.json({ invoices: [] }));
  r.post('/:id/invoices/sync', (_req, res) => res.json({ ok: true }));
  r.get('/:id/subscription', (req, res) => {
    res.json({
      tenantId: String(req.params.id),
      plan: 'basic',
      status: 'trial',
      seats: null,
      renewsAt: null,
      provider: 'fallback',
    });
  });
  r.post('/:id/impersonate', (req, res) => {
    const id = String(req.params.id);
    IMP_STATE.tenantId = id;
    IMP_STATE.startedAt = new Date().toISOString();
    IMP_STATE.by = req.user?.id || 'support';
    res.json({ ok: true, token: `impersonate:${id}`, context: IMP_STATE });
  });
  return r;
}

/* ---------------- Support (tickets & flows) fallback router ---------------- */
function makeSupportFallbackRouter() {
  const r = express.Router();

  function filterTickets({ tenantId, status }) {
    const all = Array.from(SUPPORT_STORE.TICKETS.values());
    return all.filter(t =>
      (!tenantId || t.tenantId === tenantId) &&
      (!status || t.status === status.toLowerCase())
    );
  }

  r.get('/tickets', (req, res) => {
    const items = filterTickets({
      tenantId: req.query.tenantId ? String(req.query.tenantId) : undefined,
      status: req.query.status ? String(req.query.status).toLowerCase() : undefined,
    });
    res.setHeader('X-Total-Count', String(items.length));
    res.json(items);
  });

  r.post('/tickets', (req, res) => {
    const b = req.body || {};
    const id = String(SUPPORT_STORE.nextId++);
    const now = new Date().toISOString();
    const ticket = {
      id,
      tenantId: b.tenantId || null,
      subject: b.subject || 'Support ticket',
      status: 'open',
      messages: b.body ? [{ from: 'requester', body: String(b.body), at: now }] : [],
      createdAt: now,
      updatedAt: now,
    };
    SUPPORT_STORE.TICKETS.set(id, ticket);
    res.status(201).json(ticket);
  });

  r.post('/tickets/:id/messages', (req, res) => {
    const t = SUPPORT_STORE.TICKETS.get(String(req.params.id));
    if (!t) return res.status(404).json({ error: 'Ticket not found' });
    const b = req.body || {};
    t.messages.push({ from: b.from || 'support', body: String(b.body || ''), at: new Date().toISOString() });
    t.updatedAt = new Date().toISOString();
    res.json(t);
  });

  r.patch('/tickets/:id', (req, res) => {
    const t = SUPPORT_STORE.TICKETS.get(String(req.params.id));
    if (!t) return res.status(404).json({ error: 'Ticket not found' });
    const status = req.body?.status ? String(req.body.status).toLowerCase() : null;
    if (status && ['open', 'resolved', 'canceled'].includes(status)) t.status = status;
    t.updatedAt = new Date().toISOString();
    res.json(t);
  });

  r.post('/tickets/:id/resolve', (req, res) => {
    const t = SUPPORT_STORE.TICKETS.get(String(req.params.id));
    if (!t) return res.status(404).json({ error: 'Ticket not found' });
    t.status = 'resolved';
    t.updatedAt = new Date().toISOString();
    res.json(t);
  });
  r.post('/tickets/:id/cancel', (req, res) => {
    const t = SUPPORT_STORE.TICKETS.get(String(req.params.id));
    if (!t) return res.status(404).json({ error: 'Ticket not found' });
    t.status = 'canceled';
    t.updatedAt = new Date().toISOString();
    res.json(t);
  });
  r.post('/tickets/:id/reopen', (req, res) => {
    const t = SUPPORT_STORE.TICKETS.get(String(req.params.id));
    if (!t) return res.status(404).json({ error: 'Ticket not found' });
    t.status = 'open';
    t.updatedAt = new Date().toISOString();
    res.json(t);
  });

  // ---- Comments for a ticket (aliases) ----
  r.get('/tickets/:id/comments', (req, res) => {
    const t = SUPPORT_STORE.TICKETS.get(String(req.params.id));
    if (!t) return res.status(404).json({ error: 'Ticket not found' });
    res.json({ items: t.messages || [] });
  });

  r.post('/tickets/:id/comments', (req, res) => {
    const t = SUPPORT_STORE.TICKETS.get(String(req.params.id));
    if (!t) return res.status(404).json({ error: 'Ticket not found' });
    const b = req.body || {};
    t.messages.push({
      from: b.from || 'support',
      body: String(b.body || ''),
      at: new Date().toISOString(),
    });
    t.updatedAt = new Date().toISOString();
    res.json({ ok: true });
  });

  return r;
}

/* -------------------- Impersonation (start/end/session) -------------------- */
function makeImpersonationFallbackRouter() {
  const r = express.Router();
  r.post('/tenants/:id/start', (req, res) => {
    const id = String(req.params.id);
    IMP_STATE.tenantId = id;
    IMP_STATE.startedAt = new Date().toISOString();
    IMP_STATE.by = req.user?.id || 'support';
    res.json({ ok: true, token: `impersonate:${id}`, context: IMP_STATE });
  });
  r.get('/session', (_req, res) => res.json({ context: IMP_STATE }));
  r.delete('/session', (_req, res) => {
    IMP_STATE.tenantId = null; IMP_STATE.startedAt = null; IMP_STATE.by = null;
    res.json({ ok: true });
  });
  return r;
}

/* --------------------------- System subscription API ----------------------- */
function makeSubscriptionFallbackRouter() {
  const r = express.Router();
  r.get('/', (_req, res) => {
    res.json({
      plan: process.env.SYSTEM_PLAN || 'pro',
      status: 'active',
      provider: 'fallback',
      seats: 'unlimited',
      trialEndsAt: null,
      renewsAt: null,
      features: ['support-console', 'impersonation', 'tickets', 'sms', 'billing-by-phone', 'enrichment'],
    });
  });
  return r;
}

/* ------------------------------ SMS endpoints ------------------------------ */
function makeSmsFallbackRouter() {
  const r = express.Router();

  function sendHandler(req, res) {
    const { to, message, from, tenantId } = req.body || {};
    if (!to || !message) return res.status(400).json({ error: 'to and message are required' });
    const item = {
      id: Date.now(),
      tenantId: tenantId || null,
      to: String(to),
      from: from || 'MkopoSuite',
      message: String(message),
      at: new Date().toISOString(),
      status: 'queued',
    };
    SMS_LOGS.push(item);
    res.json({ ok: true, messageId: item.id, status: item.status, provider: 'fallback' });
  }

  // Canonical
  r.post('/send', sendHandler);
  r.get('/logs', (_req, res) => res.json({ items: SMS_LOGS.slice(-100) }));
  r.get('/balance', (_req, res) => res.json({ balance: 'unknown (fallback)' }));

  // Legacy aliases when this router is mounted at /api/communications and /api/notifications
  r.post('/sms/send', sendHandler); // => /api/communications/sms/send
  r.post('/sms', sendHandler);      // => /api/notifications/sms

  return r;
}

/* ------------------------- Billing by phone endpoints ---------------------- */
function makeBillingByPhoneFallbackRouter() {
  const r = express.Router();
  r.get('/lookup', (req, res) => {
    const phone = String(req.query.phone || '').trim();
    if (!phone) return res.status(400).json({ error: 'phone query is required' });
    res.json({
      phone,
      customerId: `CUS-${phone.slice(-6) || '000000'}`,
      name: 'Demo Customer',
      balance: 0,
      invoicesCount: 0,
      lastInvoiceAt: null,
    });
  });
  return r;
}

/* ------------------------------ Enrichment API ----------------------------- */
function makeEnrichmentFallbackRouter() {
  const r = express.Router();
  r.get('/phone', (req, res) => {
    const phone = String(req.query.phone || '').trim();
    if (!phone) return res.status(400).json({ error: 'phone query is required' });
    res.json({
      phone,
      e164: phone.startsWith('+') ? phone : `+${phone}`,
      countryHint: 'TZ',
      carrierHint: 'Vodacom',
      lineType: 'mobile',
      risk: { disposable: false, recentPort: false, score: 0.1 },
    });
  });
  r.get('/email', (req, res) => {
    const email = String(req.query.email || '').trim();
    if (!email) return res.status(400).json({ error: 'email query is required' });
    const domain = email.includes('@') ? email.split('@')[1] : '';
    res.json({
      email,
      domain,
      deliverability: 'unknown',
      mxPresent: true,
      disposable: false,
    });
  });
  r.get('/org', (req, res) => {
    const name = String(req.query.name || '').trim();
    if (!name) return res.status(400).json({ error: 'name query is required' });
    res.json({
      name,
      industry: 'Microfinance',
      size: '11-50',
      website: null,
      location: null,
    });
  });
  return r;
}

/* -------------------- Compat: Comments & Repayments (in-memory) ------------ */
/* These keep the UI working even if DB routes are missing/broken. */
const COMMENTS_MEM = [];
let COMMENTS_NEXT_ID = 1;
function makeCommentsCompatRouter() {
  const r = express.Router();

  // List comments for a loan
  r.get('/loan/:loanId', (req, res) => {
    const items = COMMENTS_MEM.filter(c => String(c.loanId) === String(req.params.loanId));
    res.setHeader('X-Total-Count', String(items.length));
    res.json(items);
  });

  // Create comment
  r.post('/', (req, res) => {
    const { loanId, content } = req.body || {};
    if (!loanId || !content) {
      return res.status(400).json({ error: 'loanId and content are required' });
    }
    const c = {
      id: String(COMMENTS_NEXT_ID++),
      loanId: String(loanId),
      content: String(content),
      createdAt: new Date().toISOString(),
      author: { name: req.user?.name || 'System' },
    };
    COMMENTS_MEM.unshift(c);
    res.status(201).json(c);
  });

  return r;
}

const REPAYMENTS_MEM = [];
let REPAYMENTS_NEXT_ID = 1;
function makeRepaymentsCompatRouter() {
  const r = express.Router();

  // List repayments for a loan
  r.get('/loan/:loanId', (req, res) => {
    const items = REPAYMENTS_MEM.filter(p => String(p.loanId) === String(req.params.loanId));
    res.setHeader('X-Total-Count', String(items.length));
    res.json(items);
  });

  // Create repayment
  r.post('/', (req, res) => {
    const { loanId, amount, date, method, notes } = req.body || {};
    const amt = Number(amount);
    if (!loanId || !amt || amt <= 0) {
      return res.status(400).json({ error: 'loanId and a positive amount are required' });
    }
    const pay = {
      id: String(REPAYMENTS_NEXT_ID++),
      loanId: String(loanId),
      amount: amt,
      date: date || new Date().toISOString().slice(0, 10),
      method: method || 'cash',
      notes: notes || '',
      createdAt: new Date().toISOString(),
    };
    REPAYMENTS_MEM.unshift(pay);
    res.status(201).json(pay);
  });

  return r;
}

/* -------- Tenant-scoped bridges: tickets, sms, billing phone, enrichment --- */
function makeTenantFeatureBridgeRouter() {
  const r = express.Router({ mergeParams: true });

  // Tickets under /api/tenants/:tenantId/tickets (and alias /support/tickets)
  r.get('/:tenantId/tickets', (req, res) => {
    const tenantId = String(req.params.tenantId);
    const items = Array.from(SUPPORT_STORE.TICKETS.values()).filter(t => t.tenantId === tenantId);
    res.setHeader('X-Total-Count', String(items.length));
    res.json(items);
  });
  r.post('/:tenantId/tickets', (req, res) => {
    const tenantId = String(req.params.tenantId);
    const b = req.body || {};
    const id = String(SUPPORT_STORE.nextId++);
    const now = new Date().toISOString();
    const ticket = {
      id,
      tenantId,
      subject: b.subject || 'Support ticket',
      status: 'open',
      messages: b.body ? [{ from: 'requester', body: String(b.body), at: now }] : [],
      createdAt: now,
      updatedAt: now,
    };
    SUPPORT_STORE.TICKETS.set(id, ticket);
    res.status(201).json(ticket);
  });
  r.post('/:tenantId/tickets/:id/messages', (req, res) => {
    const t = SUPPORT_STORE.TICKETS.get(String(req.params.id));
    if (!t || t.tenantId !== String(req.params.tenantId)) return res.status(404).json({ error: 'Ticket not found' });
    const b = req.body || {};
    t.messages.push({ from: b.from || 'support', body: String(b.body || ''), at: new Date().toISOString() });
    t.updatedAt = new Date().toISOString();
    res.json(t);
  });
  r.patch('/:tenantId/tickets/:id', (req, res) => {
    const t = SUPPORT_STORE.TICKETS.get(String(req.params.id));
    if (!t || t.tenantId !== String(req.params.tenantId)) return res.status(404).json({ error: 'Ticket not found' });
    const status = req.body?.status ? String(req.body.status).toLowerCase() : null;
    if (status && ['open', 'resolved', 'canceled'].includes(status)) t.status = status;
    t.updatedAt = new Date().toISOString();
    res.json(t);
  });
  r.post('/:tenantId/tickets/:id/resolve', (req, res) => {
    const t = SUPPORT_STORE.TICKETS.get(String(req.params.id));
    if (!t || t.tenantId !== String(req.params.tenantId)) return res.status(404).json({ error: 'Ticket not found' });
    t.status = 'resolved'; t.updatedAt = new Date().toISOString(); res.json(t);
  });
  r.post('/:tenantId/tickets/:id/cancel', (req, res) => {
    const t = SUPPORT_STORE.TICKETS.get(String(req.params.id));
    if (!t || t.tenantId !== String(req.params.tenantId)) return res.status(404).json({ error: 'Ticket not found' });
    t.status = 'canceled'; t.updatedAt = new Date().toISOString(); res.json(t);
  });
  r.post('/:tenantId/tickets/:id/reopen', (req, res) => {
    const t = SUPPORT_STORE.TICKETS.get(String(req.params.id));
    if (!t || t.tenantId !== String(req.params.tenantId)) return res.status(404).json({ error: 'Ticket not found' });
    t.status = 'open'; t.updatedAt = new Date().toISOString(); res.json(t);
  });

  // Alias: /api/tenants/:tenantId/support/tickets*
  r.get('/:tenantId/support/tickets', (req, res) => {
    const tenantId = String(req.params.tenantId);
    const items = Array.from(SUPPORT_STORE.TICKETS.values()).filter(t => t.tenantId === tenantId);
    res.setHeader('X-Total-Count', String(items.length));
    res.json(items);
  });

  // SMS under tenant scope (write tenantId into logs)
  r.post('/:tenantId/sms/send', (req, res) => {
    const tenantId = String(req.params.tenantId);
    const { to, message, from } = req.body || {};
    if (!to || !message) return res.status(400).json({ error: 'to and message are required' });
    const item = {
      id: Date.now(),
      tenantId,
      to: String(to),
      from: from || 'MkopoSuite',
      message: String(message),
      at: new Date().toISOString(),
      status: 'queued',
    };
    SMS_LOGS.push(item);
    res.json({ ok: true, messageId: item.id, status: item.status });
  });
  r.get('/:tenantId/sms/logs', (req, res) => {
    const tenantId = String(req.params.tenantId);
    const items = SMS_LOGS.filter(x => x.tenantId === tenantId).slice(-100);
    res.json({ items });
  });

  // Billing-by-phone under tenant
  r.get('/:tenantId/billing/phone/lookup', (req, res) => {
    const phone = String(req.query.phone || '').trim();
    if (!phone) return res.status(400).json({ error: 'phone query is required' });
    res.json({
      tenantId: String(req.params.tenantId),
      phone,
      customerId: `CUS-${phone.slice(-6) || '000000'}`,
      name: 'Demo Customer',
      balance: 0,
      invoicesCount: 0,
      lastInvoiceAt: null,
    });
  });

  // Enrichment under tenant
  r.get('/:tenantId/enrich/phone', (req, res) => {
    const phone = String(req.query.phone || '').trim();
    if (!phone) return res.status(400).json({ error: 'phone query is required' });
    res.json({
      tenantId: String(req.params.tenantId),
      phone,
      e164: phone.startsWith('+') ? phone : `+${phone}`,
      countryHint: 'TZ',
      carrierHint: 'Vodacom',
      lineType: 'mobile',
      risk: { disposable: false, recentPort: false, score: 0.1 },
    });
  });
  r.get('/:tenantId/enrich/email', (req, res) => {
    const email = String(req.query.email || '').trim();
    if (!email) return res.status(400).json({ error: 'email query is required' });
    const domain = email.includes('@') ? email.split('@')[1] : '';
    res.json({
      tenantId: String(req.params.tenantId),
      email,
      domain,
      deliverability: 'unknown',
      mxPresent: true,
      disposable: false,
    });
  });
  r.get('/:tenantId/enrich/org', (req, res) => {
    const name = String(req.query.name || '').trim();
    if (!name) return res.status(400).json({ error: 'name query is required' });
    res.json({
      tenantId: String(req.params.tenantId),
      name,
      industry: 'Microfinance',
      size: '11-50',
      website: null,
      location: null,
    });
  });

  return r;
}

/* --------------------- Fallback org router (limits/invoices) --------------- */
function makeOrgFallbackRouter() {
  const r = express.Router();
  r.get('/limits', (_req, res) => {
    res.json({
      plan: { id: 'fallback', name: 'Basic', code: 'basic' },
      limits: { borrowers: 1000, loans: 2000 },
      entitlements: [
        'savings.view', 'accounting.view', 'collateral.view', 'loans.view',
        'investors.view', 'collections.view', 'assets.view',
      ],
      usage: { borrowers: 0, loans: 0 },
    });
  });
  r.get('/invoices', (_req, res) => res.json({ invoices: [] }));
  return r;
}

/* --------------------------------- Routes ---------------------------------- */
// Auth must exist
let authRoutes;
try { authRoutes = require('./routes/authRoutes'); }
catch (e) { console.error('FATAL: Failed to load ./routes/authRoutes.', e); throw e; }

/** Optional core */
const accountRoutes         = safeLoadRoutes('./routes/accountRoutes', makeDummyRouter({ settings: {} }));

// Borrower search BEFORE /api/borrowers
const borrowerSearchRoutes  = safeLoadRoutes('./routes/borrowerSearchRoutes', makeDummyRouter([]));
const borrowerRoutes        = safeLoadRoutes('./routes/borrowerRoutes', makeDummyRouter([]));

const loanRoutes            = safeLoadRoutes('./routes/loanRoutes', makeDummyRouter([]));
const dashboardRoutes       = safeLoadRoutes('./routes/dashboardRoutes', makeDummyRouter({}));
const savingsRoutes         = safeLoadRoutes('./routes/savingsRoutes', makeDummyRouter([]));
const disbursementRoutes    = safeLoadRoutes('./routes/loanDisbursementRoutes', makeDummyRouter([]));
const repaymentRoutes       = safeLoadRoutes('./routes/repaymentRoutes', makeDummyRouter([]));

/** Reports router (complete set) */
const reportRoutes          = safeLoadRoutes('./routes/reportRoutes', makeDummyRouter({}));

const settingRoutes         = safeLoadRoutes('./routes/settingRoutes', makeDummyRouter({}));

/* ✅ PREFER usersRoutes.js, fallback to userRoutes.js (prevents /users 404) */
const userRoutes            = safeLoadFirst(
  ['./routes/usersRoutes', './routes/userRoutes'],
  makeDummyRouter([])
);

const roleRoutes            = safeLoadRoutes('./routes/roleRoutes', makeDummyRouter([])); // ✅ fixed
const branchRoutes          = safeLoadRoutes('./routes/branchRoutes', makeDummyRouter([]));
const userRoleRoutes        = safeLoadRoutes('./routes/userRoleRoutes', makeDummyRouter([]));
const userBranchRoutes      = safeLoadRoutes('./routes/userBranchRoutes', makeDummyRouter([]));
const loanProductRoutes     = safeLoadRoutes('./routes/loanProductRoutes', makeDummyRouter([]));

/* Admin modules */
const adminStaffRoutes      = safeLoadRoutes('./routes/staffRoutes', makeDummyRouter([]));
const permissionRoutes      = safeLoadRoutes('./routes/permissionRoutes', makeDummyRouter([]));
const adminAuditRoutes      = safeLoadRoutes('./routes/admin/auditRoutes', makeDummyRouter([]));
const adminReportSubRoutes  = safeLoadRoutes('./routes/admin/reportSubscriptionRoutes', makeDummyRouter([]));

/* ✅ NEW: Admin generic CRUD endpoints (types/templates) */
const adminTypesRoutes      = safeLoadRoutes('./routes/admin/typesRoutes', makeDummyRouter([]));
const adminTemplatesRoutes  = safeLoadRoutes('./routes/admin/templatesRoutes', makeDummyRouter([]));

/* 🆕 Public signup (self-service) */
const publicSignupRoutes    = safeLoadRoutes('./routes/publicSignupRoutes', makeDummyRouter({ error: 'Signup disabled' }));

/* New modules — optional/dummy-friendly */
const collateralRoutes = safeLoadRoutes('./routes/collateralRoutes', makeDummyRouter([
  { id: 1, borrower: 'John Doe', item: 'Laptop', model: 'Dell', status: 'Active' },
  { id: 2, borrower: 'Jane Smith', item: 'Car', model: 'Toyota', status: 'Released' },
]));
const collectionSheetsRoutes = safeLoadRoutes('./routes/collectionSheetsRoutes', makeDummyRouter([
  { id: 1, type: 'FIELD', date: '2025-08-01', status: 'PENDING' },
  { id: 2, type: 'OFFICE', date: '2025-08-02', status: 'COMPLETED' },
]));
const savingsTransactionsRoutes = safeLoadRoutes('./routes/savingsTransactionsRoutes', makeDummyRouter([
  { id: 1, borrower: 'John Doe', type: 'deposit', amount: 150, date: '2025-08-01' },
  { id: 2, borrower: 'Jane Smith', type: 'withdrawal', amount: 80, date: '2025-08-03' },
]));

/* Investors */
const investorRoutes = safeLoadRoutes('./routes/investorRoute', makeDummyRouter([
  { id: 1, name: 'Alpha Capital', phone: '255700000001', shares: 10000, totalContribution: 45000000 },
  { id: 2, name: 'Beta Partners', phone: '255700000002', shares: 5500,  totalContribution: 22000000 },
]));

/* E-signatures / Payroll / HR / Expenses / Other Income / Assets / Billing */
const esignaturesRoutes = safeLoadRoutes('./routes/esignaturesRoutes', makeDummyRouter([
  { id: 1, name: 'Loan Agreement #1', sent: '2025-08-01', status: 'Signed' },
  { id: 2, name: 'Loan Agreement #2', sent: '2025-08-03', status: 'Pending' },
]));
const payrollRoutes = safeLoadRoutes('./routes/payrollRoutes', makeDummyRouter([
  { id: 1, period: '2025-07', staffCount: 8, total: 4200000 },
  { id: 2, period: '2025-08', staffCount: 9, total: 4450000 },
]));
const hrRoutes = safeLoadRoutes('./routes/hrRoutes', makeDummyRouter({ employees: [] }));
const expensesRoutes = safeLoadRoutes('./routes/expensesRoutes', makeDummyRouter([
  { id: 1, type: 'Office Rent', amount: 900000, date: '2025-08-01' },
  { id: 2, type: 'Fuel', amount: 120000, date: '2025-08-04' },
]));
const otherIncomeRoutes = safeLoadRoutes('./routes/otherIncomeRoutes', makeDummyRouter([
  { id: 1, source: 'Training Fees', amount: 250000, date: '2025-08-02' },
  { id: 2, source: 'Sale of Scrap', amount: 60000, date: '2025-08-05' },
]));
const assetManagementRoutes = safeLoadRoutes('./routes/assetManagementRoutes', makeDummyRouter([
  { id: 1, name: 'Branch Laptop 01', category: 'Electronics', status: 'In Use' },
  { id: 2, name: 'Motorcycle 02', category: 'Vehicle', status: 'Maintenance' },
]));
const billingRoutes = safeLoadRoutes('./routes/billingRoutes', makeDummyRouter({ plan: 'free', status: 'active', invoices: [] }));

const accountingRoutes = safeLoadRoutes('./routes/accountingRoutes', makeDummyRouter({
  cashflowMonthly: [
    { month: 'Jan', inflow: 5000000, outflow: 3200000 },
    { month: 'Feb', inflow: 6200000, outflow: 4100000 },
  ],
  trialBalance: [{ account: '1000 Cash', debit: 1200000, credit: 0 }],
}));

/* ✅ Banks — NEW (real route or dummy) */
const bankRoutes = safeLoadRoutes('./routes/bankRoutes', makeDummyRouter([]));

/* Tenants (real file if present; otherwise fallback keeps UI alive) */
const tenantRoutes = safeLoadRoutes('./routes/tenantRoutes', makeTenantsFallbackRouter());

/* ✅ NEW: Tenants compat shim (stats + invoices + subscription + impersonate) */
const tenantsCompatRoutes = safeLoadRoutes('./routes/tenantsCompatRoutes', makeTenantsCompatRouter());

/* ✅ NEW: Tenant feature bridge (tickets/sms/billingByPhone/enrich under tenant) */
const tenantFeatureRoutes = safeLoadRoutes('./routes/tenantFeatureRoutes', makeTenantFeatureBridgeRouter());

/* ✅ NEW: Organization (limits & invoices) */
const orgRoutes = safeLoadRoutes('./routes/orgRoutes', makeOrgFallbackRouter());

/* Super-admin: manage all tenants */
const adminTenantsRoutes = safeLoadRoutes('./routes/admin/tenantsRoutes', makeDummyRouter([]));

/* ✅ NEW: Plans + Support routes (additive, safe) */
const plansRoutes   = safeLoadRoutes('./routes/plansRoutes', makeDummyRouter([{ code: 'basic', name: 'Basic' }]));
const supportRoutes = safeLoadRoutes('./routes/supportRoutes', makeSupportFallbackRouter());

/* ✅ NEW: Impersonation, Subscription, SMS, Billing-by-phone, Enrichment */
const impersonationRoutes = safeLoadRoutes('./routes/admin/impersonationRoutes', makeImpersonationFallbackRouter());
const subscriptionRoutes  = safeLoadRoutes('./routes/subscriptionRoutes', makeSubscriptionFallbackRouter());
const smsRoutes           = safeLoadRoutes('./routes/smsRoutes', makeSmsFallbackRouter());
const billingPhoneRoutes  = safeLoadRoutes('./routes/billingPhoneRoutes', makeBillingByPhoneFallbackRouter());
const enrichmentRoutes    = safeLoadRoutes('./routes/enrichmentRoutes', makeEnrichmentFallbackRouter());

/* 🆕 Comments router (new) */
const commentRoutes       = safeLoadRoutes('./routes/commentRoutes', makeDummyRouter([]));

/* -------------------- Import guards safely (no hard crash) ----------------- */
let authenticateUser, ensureTenantActive, requireEntitlement;
try { ({ authenticateUser } = require('./middleware/authMiddleware')); } catch {}
try { ({ ensureTenantActive, requireEntitlement } = require('./middleware/tenantGuards')); } catch {}

const auth = authenticateUser ? [authenticateUser] : [];
const active = ensureTenantActive ? [ensureTenantActive] : [];
const ent = (k) => (requireEntitlement ? [requireEntitlement(k)] : []);

/* -------------------------- Automatic audit hooks -------------------------- */
/* -------------------------- Automatic audit hooks -------------------------- */
let AuditLog;
try { ({ AuditLog } = require('./models')); } catch { try { ({ AuditLog } = require('../models')); } catch {} }

function scrub(obj = {}) {
  const HIDDEN = new Set(['password','password1','password2','token','secret','otp','pin','passcode']);
  const out = {};
  for (const [k,v] of Object.entries(obj)) {
    out[k] = HIDDEN.has(String(k).toLowerCase()) ? '[redacted]' : v;
  }
  return out;
}

function deriveAction(req, ok) {
  const p = req.path.toLowerCase();
  const tail = p.split('/').filter(Boolean).slice(-1)[0] || '';
  if (req.method === 'POST' && (p.includes('/api/login') || p.includes('/api/auth/login'))) {
    return ok ? 'login:success' : 'login:failed';
  }
  if (req.method === 'POST' && (tail === 'approve' || tail === 'approved')) return 'status:approved';
  if (req.method === 'POST' && (tail === 'disburse' || tail === 'disbursed')) return 'status:disbursed';
  if (req.method === 'POST' && tail === 'reverse') return 'reverse';

  if (req.method === 'POST')   return 'create';
  if (req.method === 'PUT'
   || req.method === 'PATCH')  return 'update';
  if (req.method === 'DELETE') return 'delete';
  return `${req.method.toLowerCase()}:${tail || 'other'}`;
}

app.use((req, res, next) => {
  const started = Date.now();
  res.on('finish', () => {
    try {
      if (!AuditLog || typeof AuditLog.create !== 'function') return;
      if (!req.path.startsWith('/api/')) return;
      if (req.method === 'GET' || req.method === 'OPTIONS') return;
      if (req.path.startsWith('/api/admin/audit') || req.path.startsWith('/api/audit-logs')) return;
      if (req.path.startsWith('/uploads')) return;

      const ok = res.statusCode >= 200 && res.statusCode < 400;
      const category = (req.path.split('/')[2] || 'api').toLowerCase();
      const action = deriveAction(req, ok);

      const meta = {
        method: req.method,
        path: req.path,
        statusCode: res.statusCode,
        ms: Date.now() - started,
        ua: req.headers['user-agent'],
        ctx: req.context || null
      };

      const bodyPreview = scrub(req.body || {});
      const message = JSON.stringify({ body: bodyPreview, meta });

      AuditLog.create({
        userId:   req.user?.id || null,
        branchId: req.user?.branchId || null,
        category,
        action,
        message,
        ip: req.ip,
        reversed: false,
      }).catch(() => {});
    } catch {}
  });
  next();
});
/* ----------------------------- Branch fallback ----------------------------- */
let sequelize;
try { ({ sequelize } = require('./models')); } catch { try { ({ sequelize } = require('../models')); } catch {} }
if (sequelize && !FORCE_REAL) {
  app.get('/api/branches', async (_req, res, next) => {
    try {
      const [rows] = await sequelize.query('SELECT id, name, code FROM "public"."branches" ORDER BY name ASC;');
      return res.json(rows);
    } catch (e) { return next(); }
  });
}

/* -------------------- PUBLIC SETTINGS: sidebar (no auth) ------------------- */
/**
 * Many UIs hit /api/settings/sidebar before auth. Make it optionally public.
 * If a real controller exists, you can swap the fallback to call it.
 */
const PUBLIC_SIDEBAR_ENABLED = process.env.PUBLIC_SIDEBAR !== '0'; // default on
const DEFAULT_PUBLIC_SIDEBAR = {
  app: {
    name: process.env.APP_NAME || 'MkopoSuite',
    logoUrl: process.env.APP_LOGO_URL || null,
    version: process.env.APP_VERSION || 'dev',
  },
  // keep minimal so clients can render shells before login
  sections: [
    {
      key: 'main',
      label: 'Main',
      items: [
        { key: 'dashboard', label: 'Dashboard', path: '/dashboard', icon: 'LayoutDashboard' },
      ],
    },
  ],
};
if (PUBLIC_SIDEBAR_ENABLED) {
  app.get('/api/settings/sidebar', async (req, res) => {
    // If you later add a real controller, prefer that and fall back to this payload.
    try {
      const controller = require('./controllers/settingController'); // optional
      if (controller?.publicSidebar) {
        return controller.publicSidebar(req, res);
      }
    } catch {}
    return res.json(DEFAULT_PUBLIC_SIDEBAR);
  });
}

/* ------------------------ 🔔 Register sync listeners (ONCE) ---------------- */
try {
  // Requires: ./services/syncBus.js and ./services/syncListeners.js
  // These files set up the in-process event bus and listeners for auto-sync.
  require('./services/syncListeners');
  console.log('[sync] listeners registered]');
} catch (e) {
  if (e.code === 'MODULE_NOT_FOUND') {
    console.warn('⚠️  Sync listeners not found (./services/syncListeners). Create it to enable auto-sync.');
  } else {
    console.warn('⚠️  Failed to register sync listeners:', e.message);
  }
}

/* --------------------------------- Mounting -------------------------------- */
app.use('/api/borrowers/search', borrowerSearchRoutes);

/* 🆕 Public self-service signup (no auth) */
app.use('/api/signup', publicSignupRoutes);

app.use('/api/auth',   authRoutes);
app.use('/api/login',  authRoutes);

app.use('/api/account', accountRoutes);

/* ✅ Compat shim mounts FIRST (for /api/tenants base + aliases) */
app.use('/api/tenants', tenantsCompatRoutes);
app.use('/api/system/tenants', tenantsCompatRoutes);
app.use('/api/orgs', tenantsCompatRoutes);
app.use('/api/organizations', tenantsCompatRoutes);

/* ✅ Tenant feature bridge BEFORE canonical tenants to avoid shadowing */
app.use('/api/tenants', ...auth, ...active, tenantFeatureRoutes);

/* ✅ Single canonical tenants mount */
app.use('/api/tenants', tenantRoutes);
/* Singular alias to satisfy clients calling /api/tenant/* */
app.use('/api/tenant',  tenantRoutes);

/* ✅ NEW: Impersonation console (admin) */
app.use('/api/admin/impersonation', ...auth, ...active, impersonationRoutes);

/* ✅ NEW: System subscription (aliases included) */
app.use('/api/subscription', ...auth, ...active, subscriptionRoutes);
app.use('/api/system/subscription', ...auth, ...active, subscriptionRoutes);
app.use('/api/admin/subscription', ...auth, ...active, subscriptionRoutes);

/* ✅ NEW: SMS (canonical + legacy aliases for older UIs) */
app.use('/api/sms',            ...auth, ...active, smsRoutes);
app.use('/api/communications', ...auth, ...active, smsRoutes); // exposes /api/communications/sms/send
app.use('/api/notifications',  ...auth, ...active, smsRoutes); // exposes /api/notifications/sms

/* ✅ NEW: Billing by phone (global; mount BEFORE generic /api/billing) */
app.use('/api/billing/phone', ...auth, ...active, billingPhoneRoutes);

/* ✅ NEW: Enrichment (global) */
app.use('/api/enrich', ...auth, ...active, enrichmentRoutes);

/* ✅ NEW: Organization module (limits/invoices) */
app.use('/api/org', ...auth, ...active, orgRoutes);

/* ✅ NEW: Plans endpoints (mounted in 3 places for tolerant clients) */
app.use('/api/admin/plans', plansRoutes);
app.use('/api/billing/plans', plansRoutes);
app.use('/api/plans', plansRoutes);

/* ✅ NEW: Support endpoints (tickets, etc.) */
app.use('/api/support', ...auth, ...active, supportRoutes);
/* Admin alias for support (so /api/admin/support/tickets/* works) */
app.use('/api/admin/support', ...auth, ...active, supportRoutes);

/* Super-admin tenant console — mount REAL routes first */
app.use('/api/admin/tenants', adminTenantsRoutes);
/* Mount compat AFTER so it only catches gaps */
app.use('/api/admin/tenants', tenantsCompatRoutes);

/* ✅ NEW: Banks (use initialized router to avoid double require) */
app.use('/api/banks', ...auth, ...active, bankRoutes);

/* Alias for clients calling /api/tickets/:id/comments directly */
app.use('/api/tickets', ...auth, ...active, ticketsCommentsAlias);

/* ✅ Repayments & Comments — REAL first, then COMPAT fallback (no duplicates) */
const commentsCompatRoutes   = makeCommentsCompatRouter();
const repaymentsCompatRoutes = makeRepaymentsCompatRouter();

/* REAL repayments routes (with entitlement) */
app.use('/api/repayments', ...auth, ...active, ...ent('loans'), repaymentRoutes);
/* COMPAT repayments routes (fallback only) */
app.use('/api/repayments', ...auth, ...active, repaymentsCompatRoutes);

/* Comments (real router if present, then compat fallback) */
app.use('/api/comments', ...auth, ...active, commentRoutes);
app.use('/api/comments', ...auth, ...active, commentsCompatRoutes);

/* Feature modules with guards (no-op if guards missing) */
app.use('/api/borrowers',      ...auth, ...active, borrowerRoutes);
app.use('/api/loans',          ...auth, ...active, ...ent('loans'),       loanRoutes);
app.use('/api/dashboard',      ...auth, ...active, dashboardRoutes);
app.use('/api/savings',        ...auth, ...active, ...ent('savings'),     savingsRoutes);
app.use('/api/savings/transactions', ...auth, ...active, ...ent('savings'), savingsTransactionsRoutes);
app.use('/api/disbursements',  ...auth, ...active, ...ent('loans'),       disbursementRoutes);
/* ⛳ removed duplicate /api/repayments mounts here to avoid shadowing */
app.use('/api/reports',        ...auth, ...active, reportRoutes);
app.use('/api/settings',       ...auth, ...active, settingRoutes);

/* Admin/ACL */
app.use('/api/admin/staff',     ...auth, ...active, adminStaffRoutes);
app.use('/api/permissions',     ...auth, ...active, permissionRoutes);
app.use('/api/admin/audit',     ...auth, ...active, adminAuditRoutes);
app.use('/api/audit-logs',      ...auth, ...active, adminAuditRoutes);
app.use('/api/admin/report-subscriptions', ...auth, ...active, adminReportSubRoutes);

/* ✅ NEW admin generic CRUD mounts */
app.use('/api/admin/types',      ...auth, ...active, adminTypesRoutes);
app.use('/api/admin/templates',  ...auth, ...active, adminTemplatesRoutes);

/* Other core mounts */
app.use('/api/users',          ...auth, ...active, userRoutes);
app.use('/api/roles',          ...auth, ...active, roleRoutes);
app.use('/api/branches',       ...auth, ...active, branchRoutes);
app.use('/api/user-roles',     ...auth, ...active, userRoleRoutes);
app.use('/api/user-branches',  ...auth, ...active, userBranchRoutes);
app.use('/api/loan-products',  ...auth, ...active, loanProductRoutes);

/* New modules */
app.use('/api/collateral',           ...auth, ...active, ...ent('collateral'),   collateralRoutes);
app.use('/api/collections',          ...auth, ...active, ...ent('collections'),  collectionSheetsRoutes);
app.use('/api/investors',            ...auth, ...active, ...ent('investors'),    investorRoutes);
app.use('/api/esignatures',          ...auth, ...active, ...ent('esignatures'),  esignaturesRoutes);

/* HR & Payroll */
app.use('/api/hr',                   ...auth, ...active, hrRoutes);
app.use('/api/hr/payroll',           ...auth, ...active, ...ent('payroll'),      payrollRoutes);
app.use('/api/payroll',              ...auth, ...active, ...ent('payroll'),      payrollRoutes);

app.use('/api/expenses',             ...auth, ...active, expensesRoutes);
app.use('/api/other-income',         ...auth, ...active, otherIncomeRoutes);
app.use('/api/assets',               ...auth, ...active, ...ent('assets'),       assetManagementRoutes);
app.use('/api/billing',              ...auth, ...active, billingRoutes);

/* Accounting */
app.use('/api/accounting',           ...auth, ...active, ...ent('accounting'),   accountingRoutes);

/* ---------- Misc: metadata (no tenants stub here to avoid conflicts) ------ */
app.get('/', (_req, res) => res.send('MkopoSuite API'));
app.get('/api/meta', (_req, res) => {
  res.json({
    name: 'MkopoSuite API',
    version: process.env.APP_VERSION || 'dev',
    commit: process.env.GIT_COMMIT || undefined,
    time: new Date().toISOString(),
  });
});

/* -------------------------------- Healthchecks ----------------------------- */
app.get('/api/test',   (_req, res) => res.send('✅ API is working!'));
app.get('/api/health', (_req, res) => res.json({ ok: true, ts: new Date().toISOString() }));

try {
  let sequelize2;
  try { ({ sequelize: sequelize2 } = require('./models')); } catch { ({ sequelize: sequelize2 } = require('../models')); }
  if (sequelize2) {
    app.get('/api/health/db', async (_req, res) => {
      try { await sequelize2.authenticate(); res.json({ db: 'ok', ts: new Date().toISOString() }); }
      catch (e) { console.error('DB health error:', e); res.status(500).json({ db: 'down', error: e.message }); }
    });
    const { router: eventsRouter, events: realtime } = require('./routes/eventsRoutes');
    app.set('realtime', realtime);
    app.use('/api/events', eventsRouter);

    app.get('/api/health/db/hr-tables', async (_req, res) => {
      const expected = [
        'employees', 'employee_roles', 'employee_contracts',
        'leave_types', 'leave_requests', 'attendances',
        'payroll_runs', 'payroll_items', 'payroll_components', 'employee_documents',
      ];
      try {
        const [rows] = await sequelize2.query(`
          SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'
        `);
        const present = new Set(rows.map(r => r.table_name));
        const missing = expected.filter(t => !present.has(t));
        res.json({ ok: missing.length === 0, missing, present: expected.filter(t => present.has(t)) });
      } catch (e) {
        console.error('DB table check error:', e);
        res.status(500).json({ error: e.message });
      }
    });

    /* 🔍 extra: inspect Users columns (helps with password/password_hash issues) */
    app.get('/api/health/db/users-columns', async (_req, res) => {
      try {
        const [cols] = await sequelize2.query(`
          SELECT table_name, column_name, data_type
          FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name IN ('Users','users')
          ORDER BY table_name, ordinal_position
        `);
        let userCount = null;
        try {
          const [cnt] = await sequelize2.query(`SELECT COUNT(*)::int AS count FROM "Users"`);
          userCount = cnt?.[0]?.count ?? null;
        } catch {}
        res.json({ columns: cols, userCount });
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    });

    /* ✅ NEW: Branches-related tables/views presence check */
    app.get('/api/health/db/branches-tables', async (_req, res) => {
      // These are the tables/views your Branch UI & routes commonly rely on.
      const expected = [
        'branches',           // core table
        'users',              // or "Users" depending on old migrations
        'user_branches',      // often a VIEW used for listing assignments
        'user_branches_rt',   // runtime relation used by assign-staff
        'Borrowers',
        'Loans',
        'LoanPayments',
        'LoanRepayments',
        'expenses',
        'savingstransactions'
      ];
      try {
        const [tables] = await sequelize2.query(`
          SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'
        `);
        const [views] = await sequelize2.query(`
          SELECT table_name FROM information_schema.views WHERE table_schema = 'public'
        `);
        const presentNames = new Set([
          ...tables.map(t => t.table_name),
          ...views.map(v => v.table_name),
        ]);
        const present = expected.filter(t => presentNames.has(t));
        const missing = expected.filter(t => !presentNames.has(t));
        res.json({ ok: missing.length === 0, present, missing, totalSeenInPublic: presentNames.size });
      } catch (e) {
        console.error('DB table check error:', e);
        res.status(500).json({ error: e.message });
      }
    });
  }
} catch {}

/* -------- Optional fallback for /auth/me if your authRoutes lacks it ------- */
if (process.env.AUTH_ME_FALLBACK === '1') {
  try {
    const { authenticateUser, requireAuth } = require('./middleware/authMiddleware');
    app.get('/api/auth/me', authenticateUser, requireAuth, (req, res) => res.json(req.user));
  } catch (e) {
    console.warn('AUTH_ME_FALLBACK enabled but middleware missing:', e.message);
  }
}

/* ----------------------------------- 404 ----------------------------------- */
app.use((req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found' });
  res.status(404).send('Not found');
});

/* ------------------------------- Error handler ----------------------------- */
app.use((err, _req, res, _next) => {
  const pgCode = err?.original?.code || err?.parent?.code;

  let status = err.status || 500;
  let message;

  if (pgCode === '42P01') {
    message = 'Required table is missing. Run DB migrations on this environment (e.g. `npx sequelize-cli db:migrate`).';
  } else if (pgCode === '42703') {
    message = 'A required column is missing. Ensure migrations are up to date.';
  } else if (pgCode === '23505') {
    message = 'Unique constraint failed — a record with the same unique field already exists.';
    status = 409;
  } else if (pgCode === '23503') {
    message = 'Foreign key constraint failed — related record missing or in use.';
    status = 422;
  } else {
    message = err.expose ? err.message : (status === 500 ? 'Internal server error' : err.message);
  }

  if (process.env.NODE_ENV !== 'production') {
    console.error('❌ Error:', err);
  }

  res.status(status).json({ error: message, code: pgCode || undefined, requestId: res.getHeader('X-Request-Id') });
});

/* ------------------------------- Process hooks ----------------------------- */
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason);
});
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err);
});

module.exports = app;
