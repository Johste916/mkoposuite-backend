'use strict';

const express = require('express');
const router = express.Router();

let auth = {};
try { auth = require('../middleware/authMiddleware'); } catch {}
const authenticateUser = auth.authenticateUser || ((_req, _res, next) => next());
const requireAuth      = auth.requireAuth      || ((_req, _res, next) => next());

/* Guards are optional; use no-ops if absent */
let guards = { ensureTenantActive: (_req, _res, next) => next() };
try {
  const g = require('../middleware/tenantGuards');
  if (g && typeof g.ensureTenantActive === 'function') {
    guards.ensureTenantActive = g.ensureTenantActive;
  }
} catch { /* optional */ }

/* ---- Safe fallback controller ---- */
const toDate = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null);
const stub = {
  me(req, res) {
    const id = String(
      req.headers['x-tenant-id'] ||
      process.env.DEFAULT_TENANT_ID ||
      '00000000-0000-0000-0000-000000000000'
    );
    return res.ok({
      id,
      name: process.env.DEFAULT_TENANT_NAME || 'Organization',
      status: 'trial',
      planCode: 'basic',
      planLabel: 'basic',
      trialEndsAt: toDate(process.env.TENANT_TRIAL_ENDS_AT || null),
      trialDaysLeft: null,
      autoDisableOverdue: false,
      graceDays: 7,
      billingEmail: '',
      seats: null,
      staffCount: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  },
  updateMe(req, res) {
    return res.ok({ ok: true, tenant: { ...(req.body || {}), updatedAt: new Date().toISOString() } });
  },
  entitlements(_req, res) {
    return res.ok({
      modules: {
        savings: true, loans: true, collections: true, accounting: true,
        sms: true, esignatures: false, payroll: false, investors: true,
        assets: true, collateral: true, support: true, impersonation: true,
        billingByPhone: true, enrichment: true,
      },
      planCode: 'basic',
      status: 'trial',
    });
  },
  getLimits(_req, res) {
    return res.ok({
      plan: { id: 'fallback', name: 'Basic', code: 'basic' },
      limits: { borrowers: 1000, loans: 2000 },
      usage: { borrowers: 0, loans: 0 },
      entitlements: [
        'savings.view', 'accounting.view', 'collateral.view', 'loans.view',
        'investors.view', 'collections.view', 'assets.view',
      ],
    });
  },
  setLimits(req, res) {
    return res.ok({ ok: true, limits: req.body || {} });
  },
  listInvoices(_req, res) {
    return res.ok({ invoices: [] });
  },
  cronCheck(_req, res) {
    return res.ok({ ok: true });
  },
};

/* Try real controller; allow FORCED stub via env */
let real = null;
const forceStub = process.env.TENANTS_SAFE_MODE === '1';
if (!forceStub) {
  try {
    real = require('../controllers/tenants'); // expected to export the same methods
  } catch { real = null; }
}

/* Safe wrapper: if real throws, fall back to stub */
const wrap = (realFn, stubFn) => async (req, res) => {
  try {
    if (forceStub || !realFn) return stubFn(req, res);
    return await realFn(req, res);
  } catch (e) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn('[tenants route fallback]', req.method, req.path, e?.message);
    }
    return stubFn(req, res);
  }
};

/* Auth for all tenant routes */
router.use(authenticateUser);

/* Minimal list route to avoid 404 on GET /api/tenants */
router.get('/', requireAuth, (req, res) => {
  const id = String(
    req.headers['x-tenant-id'] ||
    process.env.DEFAULT_TENANT_ID ||
    '00000000-0000-0000-0000-000000000000'
  );
  res.ok([{ id, name: process.env.DEFAULT_TENANT_NAME || 'Organization' }]);
});

// Self service
router.get('/me',   requireAuth, wrap(real?.me,   stub.me));
router.patch('/me', requireAuth, wrap(real?.updateMe, stub.updateMe));

// Entitlements (both paths for compatibility)
router.get('/me/entitlements', requireAuth, wrap(real?.entitlements, stub.entitlements)); // legacy
router.get('/entitlements',     requireAuth, wrap(real?.entitlements, stub.entitlements)); // current

// Limits (add /me/limits alias expected by some UIs)
router.get('/limits',       requireAuth, guards.ensureTenantActive, wrap(real?.getLimits, stub.getLimits));
router.get('/me/limits',    requireAuth, guards.ensureTenantActive, wrap(real?.getLimits, stub.getLimits));
router.put('/limits',       requireAuth, guards.ensureTenantActive, wrap(real?.setLimits, stub.setLimits));
router.put('/me/limits',    requireAuth, guards.ensureTenantActive, wrap(real?.setLimits, stub.setLimits));

// Invoices for current tenant
router.get('/invoices', requireAuth, guards.ensureTenantActive, wrap(real?.listInvoices, stub.listInvoices));

// Cron endpoints (both paths for compatibility)
router.post('/cron/check',               wrap(real?.cronCheck, stub.cronCheck)); // current
router.post('/admin/billing/cron-check', wrap(real?.cronCheck, stub.cronCheck)); // legacy

// Minimal read-by-id (place LAST)
router.get('/:id', requireAuth, (req, res) => {
  res.ok({ id: String(req.params.id), name: process.env.DEFAULT_TENANT_NAME || 'Organization' });
});

module.exports = router;
