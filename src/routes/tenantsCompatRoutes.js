// routes/tenantsCompatRoutes.js
'use strict';
const express = require('express');
const router = express.Router();

// Minimal in-memory states for fallback
const IMP = { tenantId: null, startedAt: null, by: null };

router.get('/stats', async (req, res) => {
  try {
    const models = req.app.get('models');
    if (models?.Tenant && typeof models.Tenant.count === 'function') {
      // Try to build something real if you want (left minimal by design)
      const total = await models.Tenant.count();
      return res.ok({ items: [{ id: 'total', tenants: total }] });
    }
    return res.ok({ items: [] });
  } catch (e) {
    return res.fail(500, e.message);
  }
});

router.get('/:id/invoices', async (req, res) => {
  try {
    const models = req.app.get('models');
    const tenantId = String(req.params.id);
    if (models?.Invoice && models?.Tenant) {
      // Example: fetch invoices by tenantId (adapt to your schema)
      const invoices = await models.Invoice.findAll({ where: { tenantId }, limit: 50, order: [['createdAt', 'DESC']] });
      return res.ok({ invoices });
    }
    return res.ok({ invoices: [] });
  } catch (e) {
    return res.fail(500, e.message);
  }
});

router.post('/:id/invoices/sync', async (req, res) => {
  // Hook your external provider sync here; currently a no-op
  return res.ok({ ok: true });
});

router.get('/:id/subscription', async (req, res) => {
  try {
    const tenantId = String(req.params.id);
    const models = req.app.get('models');
    if (models?.Tenant) {
      const t = await models.Tenant.findByPk(tenantId);
      if (t) {
        return res.ok({
          tenantId,
          plan: (t.plan_code || 'basic').toLowerCase(),
          status: t.status || 'active',
          seats: t.seats ?? null,
          renewsAt: t.renews_at || null,
          provider: t.billing_provider || 'internal',
        });
      }
    }
    return res.ok({ tenantId, plan: 'basic', status: 'trial', seats: null, renewsAt: null, provider: 'fallback' });
  } catch (e) {
    return res.fail(500, e.message);
  }
});

router.post('/:id/impersonate', (req, res) => {
  const tenantId = String(req.params.id);
  IMP.tenantId = tenantId;
  IMP.startedAt = new Date().toISOString();
  IMP.by = req.user?.id || 'support';
  return res.ok({ ok: true, token: `impersonate:${tenantId}`, context: IMP });
});

module.exports = router;
