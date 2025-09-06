'use strict';
const express = require('express');
const router = express.Router();

const { authenticateUser, authorizeRoles } = require('../../middleware/authMiddleware');

function getModels(req) {
  try { return req.app.get('models') || require('../../models'); }
  catch { return null; }
}

const ADMIN_ROLES = ['super_admin', 'system_admin', 'developer', 'admin']; // keep 'admin' optional if you wish

// Helper: safe single row
async function one(q, sql, bind = []) {
  const [rows] = await q.query(sql, { bind });
  return rows?.[0] || null;
}
async function many(q, sql, bind = []) {
  const [rows] = await q.query(sql, { bind });
  return rows || [];
}

// Convert entitlement keys array -> {module: bool}
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

// GET /api/admin/tenants  (list + basic search)
router.get('/',
  authenticateUser,
  authorizeRoles(...ADMIN_ROLES),
  async (req, res) => {
    try {
      const m = getModels(req);
      if (!m?.sequelize) return res.status(500).json({ error: 'DB unavailable' });

      const q = m.sequelize;
      const search = (req.query.q || req.query.search || '').trim();
      const limit  = Math.min(Number(req.query.limit) || 25, 100);
      const offset = Math.max(Number(req.query.offset) || 0, 0);

      const where = search
        ? `WHERE (LOWER(name) LIKE LOWER('%' || $1 || '%')
                 OR LOWER(slug) LIKE LOWER('%' || $1 || '%')
                 OR id::text LIKE LOWER('%' || $1 || '%'))`
        : '';
      const bind = search ? [search, limit, offset] : [limit, offset];

      const rows = await many(q, `
        SELECT id, name, slug, status, plan_code, plan_id,
               trial_ends_at, grace_days, auto_disable_overdue, billing_email,
               created_at, updated_at
        FROM public.tenants
        ${where}
        ORDER BY created_at DESC
        LIMIT $${bind.length - 1} OFFSET $${bind.length}
      `, bind);

      const [{ count }] = await many(q, `
        SELECT COUNT(*)::int AS count
        FROM public.tenants ${where}
      `, search ? [search] : []);

      res.setHeader('X-Total-Count', String(count));
      return res.json(rows);
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }
);

// GET /api/admin/tenants/:id  (full overview)
router.get('/:id',
  authenticateUser,
  authorizeRoles(...ADMIN_ROLES),
  async (req, res) => {
    try {
      const m = getModels(req);
      const q = m?.sequelize;
      if (!q) return res.status(500).json({ error: 'DB unavailable' });

      const id = req.params.id;

      const t = await one(q, `
        SELECT id, name, slug, status, plan_code, plan_id,
               trial_ends_at, grace_days, auto_disable_overdue, billing_email,
               created_at, updated_at
        FROM public.tenants
        WHERE id = $1
      `, [id]);
      if (!t) return res.status(404).json({ error: 'Tenant not found' });

      // plan row (limits)
      let plan = null;
      if (t.plan_id) {
        plan = await one(q, `SELECT id, code, name, limits FROM public.plans WHERE id = $1`, [t.plan_id]);
      } else if (t.plan_code) {
        plan = await one(q, `SELECT id, code, name, limits FROM public.plans WHERE LOWER(code)=LOWER($1)`, [t.plan_code]);
      }

      // effective entitlements (plan map + overrides)
      let keys = [];
      try {
        if (plan?.id) {
          const rows = await many(q, `
            SELECT e.key
            FROM public.plan_entitlements pe
            JOIN public.entitlements e ON e.id = pe.entitlement_id
            WHERE pe.plan_id = $1
          `, [plan.id]);
          keys = rows.map(r => r.key);
        }
      } catch {}

      // overrides from feature_flags
      let overrides = {};
      try {
        const rows = await many(q, `
          SELECT key, enabled::boolean AS enabled
          FROM public.feature_flags
          WHERE tenant_id = $1
        `, [id]);
        overrides = Object.fromEntries(rows.map(r => [r.key, !!r.enabled]));
      } catch {}

      // calculate effective modules (plan keys + overrides)
      const baseMods = entKeysToModules(keys);
      for (const [k, v] of Object.entries(overrides)) {
        // translate override keys to module names (only those we know)
        if (k.endsWith('.view') || k === 'sms.send' || k === 'esign.view') {
          const map = {
            'savings.view': 'savings',
            'accounting.view': 'accounting',
            'payroll.view': 'payroll',
            'collateral.view': 'collateral',
            'loans.view': 'loans',
            'sms.send': 'sms',
            'investors.view': 'investors',
            'collections.view': 'collections',
            'esign.view': 'esignatures',
            'assets.view': 'assets',
            'reports.view': 'reports',
          };
          const mod = map[k];
          if (mod) baseMods[mod] = !!v;
        }
      }

      // invoices (if table exists)
      let invoices = [];
      try {
        invoices = await many(q, `
          SELECT id, number, amount_cents, currency, due_date, status, meta, created_at
          FROM public.invoices
          WHERE tenant_id = $1
          ORDER BY created_at DESC
        `, [id]);
      } catch {}

      res.json({
        tenant: t,
        plan: plan || null,
        modules: baseMods,
        overrides,
        invoices,
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  }
);

// PATCH /api/admin/tenants/:id (basic updates + planCode)
router.patch('/:id',
  authenticateUser,
  authorizeRoles(...ADMIN_ROLES),
  async (req, res) => {
    try {
      const m = getModels(req);
      const q = m?.sequelize;
      if (!q) return res.status(500).json({ error: 'DB unavailable' });

      const id = req.params.id;
      const b = req.body || {};

      // Update columns if they exist
      const fields = [];
      const bind = [];
      const push = (col, val) => { fields.push(`${col} = $${bind.length + 1}`); bind.push(val); };

      if (typeof b.name === 'string') push('name', b.name.trim());
      if (typeof b.status === 'string') push('status', b.status.trim());
      if (typeof b.planCode === 'string') push('plan_code', b.planCode.toLowerCase());
      if (typeof b.trialEndsAt !== 'undefined') push('trial_ends_at', b.trialEndsAt ? String(b.trialEndsAt).slice(0,10) : null);
      if (typeof b.graceDays !== 'undefined') push('grace_days', Math.max(0, Math.min(90, Number(b.graceDays || 0))));
      if (typeof b.autoDisableOverdue === 'boolean') push('auto_disable_overdue', b.autoDisableOverdue);
      if (typeof b.billingEmail === 'string') push('billing_email', b.billingEmail.trim());

      if (fields.length === 0) return res.json({ ok: true, updated: 0 });

      bind.push(id);
      const row = await one(q, `
        UPDATE public.tenants SET ${fields.join(', ')}, updated_at = NOW()
        WHERE id = $${bind.length}
        RETURNING id, name, slug, status, plan_code, plan_id, trial_ends_at, grace_days, auto_disable_overdue, billing_email, updated_at
      `, bind);

      return res.json({ ok: true, tenant: row });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  }
);

// POST /api/admin/tenants/:id/entitlements (upsert override)
// body: { key: 'loans.view'|'sms.send'|..., enabled: true|false }
router.post('/:id/entitlements',
  authenticateUser,
  authorizeRoles(...ADMIN_ROLES),
  async (req, res) => {
    try {
      const m = getModels(req);
      const q = m?.sequelize;
      if (!q) return res.status(500).json({ error: 'DB unavailable' });
      const id = req.params.id;
      const { key, enabled } = req.body || {};
      if (!key || typeof enabled !== 'boolean') {
        return res.status(400).json({ error: 'key and enabled are required' });
      }

      await q.query(`
        INSERT INTO public.feature_flags (tenant_id, key, enabled, created_at, updated_at)
        VALUES ($1,$2,$3,NOW(),NOW())
        ON CONFLICT (tenant_id, key)
        DO UPDATE SET enabled = EXCLUDED.enabled, updated_at = NOW()
      `, { bind: [id, key, !!enabled] });

      return res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  }
);

// DELETE /api/admin/tenants/:id/entitlements/:key (remove override)
router.delete('/:id/entitlements/:key',
  authenticateUser,
  authorizeRoles(...ADMIN_ROLES),
  async (req, res) => {
    try {
      const m = getModels(req);
      const q = m?.sequelize;
      if (!q) return res.status(500).json({ error: 'DB unavailable' });
      await q.query(`DELETE FROM public.feature_flags WHERE tenant_id = $1 AND key = $2`, {
        bind: [req.params.id, req.params.key]
      });
      return res.status(204).end();
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  }
);

// POST /api/admin/tenants/:id/invoices  (create placeholder)
router.post('/:id/invoices',
  authenticateUser,
  authorizeRoles(...ADMIN_ROLES),
  async (req, res) => {
    try {
      const m = getModels(req);
      const q = m?.sequelize;
      if (!q) return res.status(500).json({ error: 'DB unavailable' });

      const { amountCents, currency = 'USD', dueDate } = req.body || {};
      if (!Number.isInteger(amountCents) || amountCents <= 0) return res.status(400).json({ error: 'amountCents must be positive integer' });

      const row = await one(q, `
        INSERT INTO public.invoices (tenant_id, number, amount_cents, currency, due_date, status, created_at, updated_at)
        VALUES ($1, CONCAT('INV-', TO_CHAR(NOW(), 'YYYYMMDDHH24MISS')), $2, $3, $4, 'open', NOW(), NOW())
        RETURNING id, number, amount_cents, currency, due_date, status, created_at
      `, [req.params.id, amountCents, currency, dueDate || null]);

      res.status(201).json(row);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  }
);

// POST /api/admin/tenants/:id/invoices/:invId/pay  (mark paid)
router.post('/:id/invoices/:invId/pay',
  authenticateUser,
  authorizeRoles(...ADMIN_ROLES),
  async (req, res) => {
    try {
      const m = getModels(req);
      const q = m?.sequelize;
      if (!q) return res.status(500).json({ error: 'DB unavailable' });

      const row = await one(q, `
        UPDATE public.invoices SET status='paid', updated_at=NOW()
        WHERE id = $1 AND tenant_id = $2
        RETURNING id, number, amount_cents, currency, due_date, status, created_at
      `, [req.params.invId, req.params.id]);
      if (!row) return res.status(404).json({ error: 'Invoice not found' });
      res.json(row);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  }
);

// POST /api/admin/tenants/:id/impersonate  → returns one-time JWT for the tenant
router.post('/:id/impersonate',
  authenticateUser,
  authorizeRoles(...ADMIN_ROLES),
  async (req, res) => {
    try {
      const jwt = require('jsonwebtoken');
      const secret = process.env.JWT_SECRET || process.env.JWT_KEY;
      if (!secret) return res.status(500).json({ error: 'JWT secret not configured' });

      // the token only needs a minimal payload to sign in the tenant app;
      // your login guard already accepts id/email/name/roles if present.
      const payload = {
        sub: req.user?.id,
        act_as_tenant: req.params.id,
        // keep a short lifetime
        exp: Math.floor(Date.now()/1000) + 60 * 5, // 5 minutes
        sudo: true,
      };
      const token = jwt.sign(payload, secret);
      return res.json({ token, expiresInSeconds: 300 });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  }
);

module.exports = router;
