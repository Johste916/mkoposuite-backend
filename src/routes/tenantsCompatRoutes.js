// routes/tenantsCompatRoutes.js
'use strict';
const express = require('express');
const router = express.Router();

/* Safe helpers (no-op if app already sets res.ok/res.fail) */
router.use((req, res, next) => {
  if (!res.ok)   res.ok   = (data, extra = {}) => {
    if (typeof extra.total === 'number') res.setHeader('X-Total-Count', String(extra.total));
    return res.json(data);
  };
  if (!res.fail) res.fail = (status, message, extra = {}) => res.status(status).json({ error: message, ...extra });
  next();
});

const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
const qInt  = (v, d) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};

// Minimal in-memory states for fallback
const IMP = { tenantId: null, startedAt: null, by: null };

/** GET /stats — keep payload shape, add X-Total-Count */
router.get('/stats', async (req, res) => {
  try {
    const models = req.app.get('models');
    if (models?.Tenant && typeof models.Tenant.count === 'function') {
      const total = await models.Tenant.count();
      res.setHeader('X-Total-Count', '1');
      return res.ok({ items: [{ id: 'total', tenants: total }] });
    }
    res.setHeader('X-Total-Count', '0');
    return res.ok({ items: [] });
  } catch (e) {
    return res.fail(500, e.message);
  }
});

/** GET /:id/invoices  supports ?limit=&offset= ; keeps { invoices: [] } shape */
router.get('/:id/invoices', async (req, res) => {
  try {
    const tenantId = String(req.params.id);
    const limit = clamp(qInt(req.query.limit, 50), 1, 250);
    const offset = clamp(qInt(req.query.offset, 0), 0, 50_000);

    const models = req.app.get('models');
    if (models?.Invoice) {
      const { rows, count } = await models.Invoice.findAndCountAll({
        where: { tenantId },
        order: [['createdAt', 'DESC']],
        limit, offset
      });
      res.setHeader('X-Total-Count', String(count));
      return res.ok({ invoices: rows });
    }
    res.setHeader('X-Total-Count', '0');
    return res.ok({ invoices: [] });
  } catch (e) {
    return res.fail(500, e.message);
  }
});

router.post('/:id/invoices/sync', async (_req, res) => {
  // Hook your external provider sync here; currently a no-op
  return res.ok({ ok: true });
});

/** GET /:id/subscription — unchanged shape, real if possible, otherwise fallback */
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

/** POST /:id/impersonate — unchanged shape */
router.post('/:id/impersonate', (req, res) => {
  const tenantId = String(req.params.id);
  IMP.tenantId = tenantId;
  IMP.startedAt = new Date().toISOString();
  IMP.by = req.user?.id || 'support';
  return res.ok({ ok: true, token: `impersonate:${tenantId}`, context: IMP });
});

module.exports = router;
