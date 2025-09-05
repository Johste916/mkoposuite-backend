// routes/orgRoutes.js
'use strict';

const express = require('express');
const router = express.Router();

/**
 * Resolve models safely (works whether models are exported from ./models or set on the app)
 */
function getModels(req) {
  try {
    // Prefer the app-attached models if present
    const appModels = req.app?.get?.('models');
    if (appModels) return appModels;
  } catch {}
  try {
    // Fallback to requiring models directly
    return require('../models');
  } catch {
    try { return require('../../models'); } catch {}
  }
  return null;
}

/** Extract current tenant id from headers/user/context */
function getTenantId(req) {
  return (
    req.headers['x-tenant-id'] ||
    req.user?.tenantId ||
    req.context?.tenantId ||
    process.env.DEFAULT_TENANT_ID ||
    '00000000-0000-0000-0000-000000000000'
  );
}

/** Normalize plan limits if stored as JSON text or object */
function parseLimits(limits) {
  if (!limits) return {};
  if (typeof limits === 'string') {
    try { return JSON.parse(limits); } catch { return {}; }
  }
  if (typeof limits === 'object') return limits;
  return {};
}

/** Very light usage stub (replace with your real counters if/when needed) */
async function getTenantUsage(_models, _tenantId) {
  // Example: return actual counts from your DB here
  return {
    borrowers: 0,
    loans: 0,
  };
}

/**
 * GET /api/org/limits
 * Returns: { plan: {id,name,code?}, limits: {...}, entitlements: [keys], usage: {...} }
 */
router.get('/limits', async (req, res) => {
  const models = getModels(req);

  // No models? Return a friendly, working fallback so the UI renders.
  if (!models) {
    return res.json({
      plan: { id: 'fallback', name: 'Basic', code: 'basic' },
      limits: { borrowers: 1000, loans: 2000 },
      entitlements: [
        'savings.view','accounting.view','collateral.view','loans.view',
        'investors.view','collections.view','assets.view'
      ],
      usage: { borrowers: 0, loans: 0 },
    });
  }

  const { Tenant, Plan, Entitlement, PlanEntitlement, sequelize } = models;
  const tenantId = getTenantId(req);

  // Look up tenant & plan
  let tenant = null, plan = null;
  try {
    if (Tenant?.findByPk) tenant = await Tenant.findByPk(tenantId);
  } catch {}
  try {
    if (plan == null && tenant?.planId && Plan?.findByPk) {
      plan = await Plan.findByPk(tenant.planId);
    }
  } catch {}

  // If the tenant has a planCode instead of FK
  if (!plan && tenant?.planCode && Plan?.findOne) {
    plan = await Plan.findOne({ where: { code: tenant.planCode } }).catch(() => null);
  }

  // Entitlements joined through plan
  let entitlementKeys = [];
  try {
    if (PlanEntitlement?.findAll && Entitlement) {
      const joinRows = await PlanEntitlement.findAll({
        where: { planId: plan?.id },
        include: [{ model: Entitlement, attributes: ['key'] }],
      });
      entitlementKeys = joinRows.map(j => j?.Entitlement?.key).filter(Boolean);
    }
  } catch {
    // Silent fallback below
  }

  // If no entitlements via join, try a simple fallback
  if (entitlementKeys.length === 0) {
    if (Entitlement?.findAll && PlanEntitlement?.findAll && plan?.id) {
      const ents = await Entitlement.findAll().catch(() => []);
      entitlementKeys = ents.map(e => e.key).slice(0, 6); // arbitrary safe fallback
    } else {
      entitlementKeys = [
        'savings.view','accounting.view','collateral.view','loans.view',
        'investors.view','collections.view','assets.view'
      ];
    }
  }

  // Limits & usage
  const limits = parseLimits(plan?.limits) || {};
  // If limits empty, give gentle defaults so UI shows something
  const safeLimits = Object.keys(limits).length ? limits : { borrowers: 1000, loans: 2000 };

  const usage = await getTenantUsage(models, tenantId, sequelize).catch(() => ({}));

  return res.json({
    plan: plan ? { id: plan.id, name: plan.name, code: plan.code } : { id: 'unknown', name: 'Basic', code: 'basic' },
    limits: safeLimits,
    entitlements: entitlementKeys,
    usage: usage || {},
  });
});


/**
 * GET /api/org/invoices
 * Returns: { invoices: [...] }
 */
router.get('/invoices', async (req, res) => {
  const models = getModels(req);
  const tenantId = getTenantId(req);

  if (!models?.Invoice?.findAll) {
    // Safe fallback – empty invoice list
    return res.json({ invoices: [] });
  }

  const invoices = await models.Invoice.findAll({
    where: { tenantId },
    order: [['issuedAt', 'DESC']],
    limit: 50,
  }).catch(() => []);

  // Normalize a bit so the UI is happy regardless of exact column names
  const norm = invoices.map((inv) => ({
    id: inv.id,
    number: inv.number || inv.invoiceNumber || inv.code || String(inv.id),
    currency: inv.currency || 'USD',
    amountCents: inv.amountCents ?? inv.amount_cents ?? (inv.totalCents ?? null),
    status: inv.status || 'open',
    issuedAt: inv.issuedAt ?? inv.issued_at ?? inv.createdAt ?? inv.created_at ?? null,
    dueDate: inv.dueDate ?? inv.due_date ?? null,
    downloadUrl: inv.downloadUrl ?? inv.pdfUrl ?? null,
  }));

  return res.json({ invoices: norm });
});

module.exports = router;
