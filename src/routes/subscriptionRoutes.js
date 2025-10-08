// routes/subscriptionRoutes.js
'use strict';

const express = require('express');
const router = express.Router();

function getSequelize(req) {
  const models = req.app.get('models');
  if (models?.sequelize) return models.sequelize;
  try { return require('../models').sequelize; } catch { return null; }
}
function getTenantId(req) {
  return req.headers['x-tenant-id'] || req.context?.tenantId || null;
}
function ok(res, data) { return (res.ok ? res.ok(data) : res.json(data)); }
function fail(res, code, msg, extra = {}) {
  return (res.fail ? res.fail(code, msg, extra) : res.status(code).json({ error: msg, ...extra }));
}

/**
 * GET /api/subscription
 * - If x-tenant-id present: returns tenant subscription joined with plan details
 * - Else: returns the global/system subscription shape (back-compat)
 */
router.get('/', async (req, res) => {
  const tenantId = getTenantId(req);

  // Global/system fallback (no tenant header)
  if (!tenantId) {
    return ok(res, {
      plan: process.env.SYSTEM_PLAN || 'pro',
      status: 'active',
      provider: 'fallback',
      seats: 'unlimited',
      trialEndsAt: null,
      renewsAt: null,
      features: ['support-console','impersonation','tickets','sms','billing-by-phone','enrichment'],
    });
  }

  const sequelize = getSequelize(req);
  if (!sequelize) return fail(res, 503, 'DB unavailable');

  try {
    const [rows] = await sequelize.query(
      `
      SELECT s.id, s.tenant_id, s.plan_id, s.status, s.seats, s.provider, s.external_id,
             s.trial_ends_at, s.renews_at, s.meta, s.created_at, s.updated_at,
             p.code AS plan_code, p.name AS plan_name, p.description AS plan_description,
             p.price_cents, p.currency, p."interval", p.features AS plan_features
      FROM public.billing_subscriptions s
      LEFT JOIN public.billing_plans p ON p.id = s.plan_id
      WHERE s.tenant_id = $1
      ORDER BY s.updated_at DESC
      LIMIT 1
      `,
      { bind: [tenantId] }
    );

    if (!rows.length) {
      return ok(res, {
        tenant_id: tenantId,
        subscription: null,
        hint: 'No subscription found for this tenant. Use PUT /api/subscription to create one.'
      });
    }
    return ok(res, rows[0]);
  } catch (e) {
    return fail(res, 500, e.message);
  }
});

/**
 * PUT /api/subscription
 * Body: { planCode, seats, status, provider, externalId, trialEndsAt, renewsAt, meta }
 * - Upserts a subscription for the current tenant (by x-tenant-id)
 */
router.put('/', async (req, res) => {
  const sequelize = getSequelize(req);
  if (!sequelize) return fail(res, 503, 'DB unavailable');
  const tenantId = getTenantId(req);
  if (!tenantId) return fail(res, 400, 'x-tenant-id header is required');

  const {
    planCode, seats = null, status = null, provider = null, externalId = null,
    trialEndsAt = null, renewsAt = null, meta = {}
  } = req.body || {};

  if (!planCode && !provider) {
    return fail(res, 400, 'planCode (or provider) is required');
  }

  try {
    // Resolve plan_id (if planCode provided)
    let planId = null;
    if (planCode) {
      const [plans] = await sequelize.query(
        `SELECT id FROM public.billing_plans WHERE code = $1`,
        { bind: [String(planCode)] }
      );
      if (!plans.length) return fail(res, 404, 'Plan code not found');
      planId = plans[0].id;
    }

    // Does a subscription already exist for this tenant?
    const [existing] = await sequelize.query(
      `SELECT id FROM public.billing_subscriptions WHERE tenant_id = $1 LIMIT 1`,
      { bind: [tenantId] }
    );

    let subRow;
    if (!existing.length) {
      // Insert (defaults for created_at/updated_at handled by DB)
      const [ins] = await sequelize.query(
        `
        INSERT INTO public.billing_subscriptions
          (tenant_id, plan_id, status, seats, provider, external_id, trial_ends_at, renews_at, meta)
        VALUES
          ($1, $2, COALESCE($3,'active'), $4, $5, $6, $7, $8, $9::jsonb)
        RETURNING *;
        `,
        { bind: [tenantId, planId, status, seats, provider, externalId, trialEndsAt, renewsAt, JSON.stringify(meta || {})] }
      );
      subRow = ins[0];
    } else {
      // Update
      const [upd] = await sequelize.query(
        `
        UPDATE public.billing_subscriptions
        SET plan_id       = COALESCE($2, plan_id),
            status        = COALESCE($3, status),
            seats         = COALESCE($4, seats),
            provider      = COALESCE($5, provider),
            external_id   = COALESCE($6, external_id),
            trial_ends_at = COALESCE($7, trial_ends_at),
            renews_at     = COALESCE($8, renews_at),
            meta          = COALESCE($9::jsonb, meta)
        WHERE tenant_id = $1
        RETURNING *;
        `,
        { bind: [tenantId, planId, status, seats, provider, externalId, trialEndsAt, renewsAt, JSON.stringify(meta || {})] }
      );
      subRow = upd[0];
    }

    // Join with plan details for convenience
    const [full] = await sequelize.query(
      `
      SELECT s.*, p.code AS plan_code, p.name AS plan_name, p.description AS plan_description,
             p.price_cents, p.currency, p."interval", p.features AS plan_features
      FROM public.billing_subscriptions s
      LEFT JOIN public.billing_plans p ON p.id = s.plan_id
      WHERE s.id = $1
      `,
      { bind: [subRow.id] }
    );

    return ok(res, full[0]);
  } catch (e) {
    return fail(res, 500, e.message);
  }
});

/**
 * POST /api/subscription/entitlements/sync
 * - Derives a "modules" entitlement from the selected plan’s features
 */
router.post('/entitlements/sync', async (req, res) => {
  const sequelize = getSequelize(req);
  if (!sequelize) return fail(res, 503, 'DB unavailable');
  const tenantId = getTenantId(req);
  if (!tenantId) return fail(res, 400, 'x-tenant-id header is required');

  try {
    const [rowset] = await sequelize.query(
      `
      SELECT p.features
      FROM public.billing_subscriptions s
      JOIN public.billing_plans p ON p.id = s.plan_id
      WHERE s.tenant_id = $1
      ORDER BY s.updated_at DESC
      LIMIT 1
      `,
      { bind: [tenantId] }
    );

    if (!rowset.length) return fail(res, 404, 'No subscription found to sync entitlements from');
    const features = rowset[0].features || {};
    const modules = (features.modules && typeof features.modules === 'object') ? features.modules : {};

    await sequelize.query(
      `
      INSERT INTO public.billing_entitlements (tenant_id, key, value, source)
      VALUES ($1, 'modules', $2::jsonb, 'plan')
      ON CONFLICT (tenant_id, key)
      DO UPDATE SET value = EXCLUDED.value, source='plan', updated_at = now()
      `,
      { bind: [tenantId, JSON.stringify(modules)] }
    );

    return ok(res, { ok: true, tenantId, updated: ['modules'] });
  } catch (e) {
    return fail(res, 500, e.message);
  }
});

module.exports = router;
