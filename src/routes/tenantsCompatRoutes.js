// routes/tenantsCompatRoutes.js
'use strict';

const express = require('express');
const router = express.Router();

/* ------------------------------------------------------------------ */
/* Small helpers + safe res helpers (in case app.js didn't add them)  */
/* ------------------------------------------------------------------ */
router.use((req, res, next) => {
  if (!res.ok) {
    res.ok = (data, extra = {}) => {
      if (typeof extra.total === 'number') {
        res.setHeader('X-Total-Count', String(extra.total));
      }
      return res.json(data);
    };
  }
  if (!res.fail) {
    res.fail = (status, message, extra = {}) =>
      res.status(status).json({ error: message, ...extra });
  }
  next();
});

const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
const qInt = (v, d) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};

// Minimal in-memory state for impersonation compatibility
const IMP = { tenantId: null, startedAt: null, by: null };

/* ------------------------------------------------------------------ */
/* GET /stats  — DB-aware if possible, clean fallback if not           */
/* ------------------------------------------------------------------ */
router.get('/stats', async (req, res) => {
  let items = [];
  try {
    const models = req.app.get('models');
    if (models?.Tenant?.count) {
      const total = await models.Tenant.count().catch(() => null);
      if (Number.isFinite(total)) items = [{ id: 'total', tenants: total }];
    }
  } catch {
    // swallow and fallback
  }
  res.setHeader('X-Total-Count', String(items.length));
  return res.ok({ items });
});

/* ------------------------------------------------------------------ */
/* GET /:id/invoices  — supports ?limit=&offset=; always returns 200  */
/* ------------------------------------------------------------------ */
router.get('/:id/invoices', async (req, res) => {
  const tenantId = String(req.params.id);
  const limit = clamp(qInt(req.query.limit, 50), 1, 250);
  const offset = clamp(qInt(req.query.offset, 0), 0, 50_000);

  let invoices = [];
  let total = 0;

  try {
    const models = req.app.get('models');
    if (models?.Invoice?.findAndCountAll) {
      const { rows, count } = await models.Invoice.findAndCountAll({
        where: { tenantId },
        order: [['createdAt', 'DESC']],
        limit,
        offset,
      });
      invoices = rows || [];
      total = Number.isFinite(count) ? count : invoices.length;
    }
  } catch {
    // swallow and fallback: invoices = [], total = 0
  }

  res.setHeader('X-Total-Count', String(total));
  return res.ok({ invoices });
});

/* ------------------------------------------------------------------ */
/* POST /:id/invoices/sync — no-op hook (won't crash)                 */
/* ------------------------------------------------------------------ */
router.post('/:id/invoices/sync', (_req, res) => {
  return res.ok({ ok: true });
});

/* ------------------------------------------------------------------ */
/* GET /:id/subscription — DB-aware if possible, clean fallback       */
/* ------------------------------------------------------------------ */
router.get('/:id/subscription', async (req, res) => {
  const tenantId = String(req.params.id);
  let payload = {
    tenantId,
    plan: 'basic',
    status: 'trial',
    seats: null,
    renewsAt: null,
    provider: 'fallback',
  };

  try {
    const models = req.app.get('models');
    if (models?.Tenant?.findByPk) {
      const t = await models.Tenant.findByPk(tenantId);
      if (t) {
        payload = {
          tenantId,
          plan: (t.plan_code || 'basic').toLowerCase(),
          status: t.status || 'active',
          seats: t.seats ?? null,
          renewsAt: t.renews_at || null,
          provider: t.billing_provider || 'internal',
        };
      }
    }
  } catch {
    // swallow and keep fallback payload
  }

  return res.ok(payload);
});

/* ------------------------------------------------------------------ */
/* POST /:id/impersonate — unchanged shape, in-memory context         */
/* ------------------------------------------------------------------ */
router.post('/:id/impersonate', (req, res) => {
  const tenantId = String(req.params.id);
  IMP.tenantId = tenantId;
  IMP.startedAt = new Date().toISOString();
  IMP.by = req.user?.id || 'support';
  return res.ok({ ok: true, token: `impersonate:${tenantId}`, context: IMP });
});

module.exports = router;
