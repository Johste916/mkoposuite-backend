'use strict';
const express = require('express');
const router = express.Router();

/** Helper to fetch models safely */
function getModels(req) {
  try { return req.app.get('models') || require('../models'); }
  catch { return null; }
}

async function getTenantPlanInfo(models, tenantId) {
  const q = models?.sequelize;
  if (!q) return { planCode: 'basic', planId: null };

  // Try to read the tenant's plan (works whether columns exist or not)
  try {
    const [rows] = await q.query(`
      SELECT plan_code, plan_id
      FROM public.tenants
      WHERE id = $1
      LIMIT 1
    `, { bind: [tenantId] });
    if (rows?.length) {
      return {
        planCode: (rows[0].plan_code || 'basic')?.toLowerCase() || 'basic',
        planId: rows[0].plan_id || null
      };
    }
  } catch (_) {}
  return { planCode: 'basic', planId: null };
}

async function getPlanRecord(models, { planCode, planId }) {
  const q = models?.sequelize;
  if (!q) return null;
  try {
    if (planId) {
      const [rows] = await q.query(`SELECT id, code, name, limits FROM public.plans WHERE id = $1 LIMIT 1`, { bind: [planId] });
      if (rows?.length) return rows[0];
    }
    const [rows2] = await q.query(`SELECT id, code, name, limits FROM public.plans WHERE LOWER(code) = LOWER($1) LIMIT 1`, { bind: [planCode] });
    return rows2?.[0] || null;
  } catch (_) { return null; }
}

function entKeysToModules(keys) {
  const on = new Set(keys || []);
  const has = (k) => on.has(k);
  return {
    savings:      has('savings.view'),
    accounting:   has('accounting.view'),
    payroll:      has('payroll.view'),
    collateral:   has('collateral.view'),
    loans:        has('loans.view'),
    sms:          has('sms.send'),
    investors:    has('investors.view'),
    collections:  has('collections.view'),
    esignatures:  has('esign.view'),
    assets:       has('assets.view'),
    reports:      has('reports.view'),
  };
}

/** GET /api/org/limits */
router.get('/limits', async (req, res) => {
  try {
    const models = getModels(req);
    const tenantId = req.headers['x-tenant-id'] || null;

    const tp = await getTenantPlanInfo(models, tenantId);
    const plan = await getPlanRecord(models, tp);

    if (!plan) return res.ok({
      plan: { id: null, code: (tp.planCode || 'basic'), name: (tp.planCode || 'basic').toUpperCase() },
      limits: {},
      usage: {},
    });

    // Optionally compute usage (safe fallbacks)
    let borrowers = 0, loans = 0;
    try {
      const q = models.sequelize;
      const [b] = await q.query(`SELECT COUNT(*)::int AS c FROM public.borrowers`);
      const [l] = await q.query(`SELECT COUNT(*)::int AS c FROM public.loans`);
      borrowers = b?.[0]?.c || 0;
      loans = l?.[0]?.c || 0;
    } catch {}

    res.ok({
      plan: { id: plan.id, code: plan.code, name: plan.name },
      limits: plan.limits || {},
      usage: { borrowers, loans },
    });
  } catch (e) {
    res.fail(500, e.message || 'Failed to load limits');
  }
});

/** GET /api/org/entitlements */
router.get('/entitlements', async (req, res) => {
  try {
    const models = getModels(req);
    const tp = await getTenantPlanInfo(models, req.headers['x-tenant-id'] || null);
    const plan = await getPlanRecord(models, tp);

    if (!plan) return res.ok({ modules: entKeysToModules([]), planCode: tp.planCode || 'basic', status: 'active' });

    let keys = [];
    try {
      const [rows] = await models.sequelize.query(`
        SELECT e.key
        FROM public.plan_entitlements pe
        JOIN public.entitlements e ON e.id = pe.entitlement_id
        WHERE pe.plan_id = $1
      `, { bind: [plan.id] });
      keys = rows.map(r => r.key);
    } catch {}

    res.ok({ modules: entKeysToModules(keys), planCode: plan.code, status: 'active' });
  } catch (e) {
    res.fail(500, e.message || 'Failed to load entitlements');
  }
});

/** GET /api/org/invoices  (placeholder; real billing system can replace) */
router.get('/invoices', async (_req, res) => {
  res.ok({ invoices: [] });
});

module.exports = router;
