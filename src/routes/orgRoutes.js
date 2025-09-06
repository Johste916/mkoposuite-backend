'use strict';
const express = require('express');
const router = express.Router();

/** Helper to fetch models safely */
function getModels(req) {
  try { return req.app.get('models') || require('../models'); }
  catch { return null; }
}

const DEFAULT_LIMITS = {
  basic:      { borrowers: 1000,  loans: 2000,  sms_credits: 0 },
  pro:        { borrowers: 10000, loans: 20000, sms_credits: 1000 },
  premium:    { borrowers: null,  loans: null,  sms_credits: null }, // unlimited
  enterprise: { borrowers: null,  loans: null,  sms_credits: null }, // alias of premium
};

const ENT_KEYS = [
  'savings.view','accounting.view','payroll.view','collateral.view',
  'loans.view','sms.send','investors.view','collections.view',
  'esign.view','assets.view','reports.view'
];
const BASIC_KEYS = new Set([
  'savings.view','accounting.view','collateral.view',
  'loans.view','investors.view','collections.view','assets.view'
]);

function normalizePlanCode(code) {
  const c = (code || 'basic').toLowerCase();
  // Treat premium as enterprise interchangeably
  if (c === 'enterprise') return 'premium';
  return c;
}

async function getTenantPlanInfo(models, tenantId) {
  const q = models?.sequelize;
  if (!q) return { planCode: 'basic', planId: null };

  try {
    const [rows] = await q.query(`
      SELECT plan_code, plan_id
      FROM public.tenants
      WHERE id = $1
      LIMIT 1
    `, { bind: [tenantId] });
    if (rows?.length) {
      return {
        planCode: normalizePlanCode(rows[0].plan_code || 'basic'),
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
      const [rows] = await q.query(
        `SELECT id, code, name, limits FROM public.plans WHERE id = $1 LIMIT 1`,
        { bind: [planId] }
      );
      if (rows?.length) return rows[0];
    }
    const [rows2] = await q.query(
      `SELECT id, code, name, limits FROM public.plans WHERE LOWER(code) = LOWER($1) LIMIT 1`,
      { bind: [planCode] }
    );
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
    const planCode = normalizePlanCode(tp.planCode);
    const plan = await getPlanRecord(models, { planCode, planId: tp.planId });

    // DB-backed plan if present; otherwise synthetic plan with defaults
    const effective = plan || {
      id: null,
      code: planCode,
      name: planCode.charAt(0).toUpperCase() + planCode.slice(1),
      limits: DEFAULT_LIMITS[planCode] || {},
    };

    // Optionally compute usage (safe fallbacks)
    let borrowers = 0, loans = 0;
    try {
      const q = models?.sequelize;
      if (q) {
        const [b] = await q.query(`SELECT COUNT(*)::int AS c FROM public.borrowers`);
        const [l] = await q.query(`SELECT COUNT(*)::int AS c FROM public.loans`);
        borrowers = b?.[0]?.c || 0;
        loans = l?.[0]?.c || 0;
      }
    } catch {}

    res.json({
      plan: { id: effective.id, code: effective.code, name: effective.name },
      limits: effective.limits || {},
      usage: { borrowers, loans },
    });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Failed to load limits' });
  }
});

/** GET /api/org/entitlements */
router.get('/entitlements', async (req, res) => {
  try {
    const models = getModels(req);
    const tp = await getTenantPlanInfo(models, req.headers['x-tenant-id'] || null);
    const planCode = normalizePlanCode(tp.planCode);
    const plan = await getPlanRecord(models, { planCode, planId: tp.planId });

    // If DB join exists, use it; otherwise synthesize from defaults
    if (plan && models?.sequelize) {
      try {
        const [rows] = await models.sequelize.query(`
          SELECT e.key
          FROM public.plan_entitlements pe
          JOIN public.entitlements e ON e.id = pe.entitlement_id
          WHERE pe.plan_id = $1
        `, { bind: [plan.id] });
        return res.json({
          modules: entKeysToModules(rows.map(r => r.key)),
          planCode: plan.code,
          status: 'active'
        });
      } catch (_) {}
    }

    // Fallback: basic subset, pro/premium all
    const keys = planCode === 'basic'
      ? ENT_KEYS.filter(k => BASIC_KEYS.has(k))
      : ENT_KEYS.slice();
    res.json({
      modules: entKeysToModules(keys),
      planCode,
      status: 'active'
    });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Failed to load entitlements' });
  }
});

/** GET /api/org/invoices */
router.get('/invoices', async (_req, res) => {
  res.json({ invoices: [] });
});

module.exports = router;
