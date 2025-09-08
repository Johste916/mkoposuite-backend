'use strict';

const express = require('express');
const router = express.Router();
let sequelize, QueryTypes;
try {
  ({ sequelize } = require('../../models'));
  ({ QueryTypes } = require('sequelize'));
} catch {}

/* ------------------------------- Utilities -------------------------------- */

const isPgMissingTable = (e) =>
  e?.original?.code === '42P01' || e?.parent?.code === '42P01';

const toBool = (v) => {
  if (typeof v === 'boolean') return v;
  if (v == null) return undefined;
  const s = String(v).toLowerCase();
  if (['1','true','yes','on'].includes(s)) return true;
  if (['0','false','no','off'].includes(s)) return false;
  return undefined;
};

const parseIntSafe = (v, d) => {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) && n >= 0 ? n : d;
};

const ALLOWED_SORT = new Set(['created_at','updated_at','name','status','plan_code']);
const ALLOWED_STATUS = new Set(['active','suspended','trial','trialing','past_due']);

/* ------------------------- Shape converters (DTO) ------------------------- */

function toRowShape(t) {
  if (!t) return null;
  return {
    id: t.id,
    name: t.name,
    status: t.status,
    planCode: (t.plan_code || 'basic').toLowerCase(),
    planLabel: (t.plan_code || 'basic').toLowerCase(),
    billingEmail: t.billing_email || null,
    trialEndsAt: t.trial_ends_at || null,
    autoDisableOverdue: !!t.auto_disable_overdue,
    graceDays: Number.isFinite(Number(t.grace_days)) ? Number(t.grace_days) : null,
    seats: t.seats ?? null,
    staffCount: t.staff_count ?? null,
    createdAt: t.created_at,
    updatedAt: t.updated_at,
  };
}

/* --------------------------------- LIST ----------------------------------- */
/**
 * GET /api/admin/tenants
 * Query:
 *   q            - search by name or billing_email
 *   status       - filter by tenant status
 *   plan         - filter by plan_code
 *   limit, offset
 *   sort         - created_at|updated_at|name|status|plan_code
 *   order        - asc|desc
 */
router.get('/', async (req, res, next) => {
  const limit  = Math.min(parseIntSafe(req.query.limit, 50), 200);
  const offset = parseIntSafe(req.query.offset, 0);
  const order  = String(req.query.order || 'desc').toLowerCase() === 'asc' ? 'asc' : 'desc';
  const sort   = ALLOWED_SORT.has(String(req.query.sort || '').toLowerCase())
    ? String(req.query.sort).toLowerCase()
    : 'created_at';

  const q = (req.query.q || '').trim();
  const status = (req.query.status || '').toLowerCase();
  const plan   = (req.query.plan || '').toLowerCase();

  try {
    if (!sequelize) {
      res.setHeader('X-Total-Count', '0');
      return res.json([]);
    }

    const where = [];
    const repl  = { limit, offset };

    if (q) {
      where.push(`(name ILIKE :q OR billing_email ILIKE :q)`);
      repl.q = `%${q}%`;
    }
    if (status && ALLOWED_STATUS.has(status)) {
      where.push(`status = :status`);
      repl.status = status;
    }
    if (plan) {
      where.push(`LOWER(plan_code) = :plan`);
      repl.plan = plan;
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const [{ total }] = await sequelize.query(
      `SELECT COUNT(1) AS total FROM public.tenants ${whereSql};`,
      { replacements: repl, type: QueryTypes.SELECT }
    );

    const rows = await sequelize.query(
      `
      SELECT id, name, status, plan_code, billing_email, trial_ends_at,
             auto_disable_overdue, grace_days, seats, staff_count,
             created_at, updated_at
        FROM public.tenants
        ${whereSql}
        ORDER BY ${sort} ${order}
        LIMIT :limit OFFSET :offset;
      `,
      { replacements: repl, type: QueryTypes.SELECT }
    );

    res.setHeader('X-Total-Count', String(total || 0));
    return res.json(rows.map(toRowShape));
  } catch (e) {
    if (isPgMissingTable(e)) {
      res.setHeader('X-Total-Count', '0');
      return res.json([]);
    }
    return next(e);
  }
});

/* --------------------------------- READ ----------------------------------- */
router.get('/:id', async (req, res, next) => {
  try {
    if (!sequelize) return res.status(404).json({ error: 'Not found' });
    const rows = await sequelize.query(
      `
      SELECT id, name, status, plan_code, billing_email, trial_ends_at,
             auto_disable_overdue, grace_days, seats, staff_count,
             created_at, updated_at
        FROM public.tenants
       WHERE id = :id
       LIMIT 1;
      `,
      { replacements: { id: req.params.id }, type: QueryTypes.SELECT }
    );
    const row = rows[0];
    if (!row) return res.status(404).json({ error: 'Not found' });
    return res.json(toRowShape(row));
  } catch (e) {
    if (isPgMissingTable(e)) return res.status(404).json({ error: 'Not found' });
    return next(e);
  }
});

/* --------------------------------- PATCH ---------------------------------- */
router.patch('/:id', async (req, res, next) => {
  const body = req.body || {};
  const sets = [];
  const rep  = { id: req.params.id };

  if (typeof body.name === 'string')               { sets.push(`name = :name`); rep.name = body.name.trim(); }
  if (typeof body.status === 'string')             { sets.push(`status = :status`); rep.status = body.status.trim().toLowerCase(); }
  if (typeof body.planCode === 'string')           { sets.push(`plan_code = :plan_code`); rep.plan_code = body.planCode.trim().toLowerCase(); }
  if (typeof body.billingEmail === 'string')       { sets.push(`billing_email = :billing_email`); rep.billing_email = body.billingEmail.trim(); }
  if ('autoDisableOverdue' in body) {
    const v = toBool(body.autoDisableOverdue);
    if (typeof v === 'boolean') { sets.push(`auto_disable_overdue = :ado`); rep.ado = v; }
  }
  if ('graceDays' in body && Number.isFinite(Number(body.graceDays))) {
    sets.push(`grace_days = :grace_days`); rep.grace_days = Math.max(0, Math.min(90, Number(body.graceDays)));
  }
  if ('seats' in body && (body.seats === null || Number.isFinite(Number(body.seats)))) {
    sets.push(`seats = :seats`); rep.seats = body.seats === null ? null : Number(body.seats);
  }
  if ('trialEndsAt' in body) {
    if (body.trialEndsAt === null || body.trialEndsAt === '') {
      sets.push(`trial_ends_at = NULL`);
    } else if (typeof body.trialEndsAt === 'string') {
      sets.push(`trial_ends_at = :trial_ends_at`); rep.trial_ends_at = body.trialEndsAt.slice(0,10);
    }
  }

  if (!sets.length) return res.json({ ok: true });

  try {
    if (!sequelize) return res.status(503).json({ error: 'DB not available' });
    await sequelize.query(
      `
      UPDATE public.tenants
         SET ${sets.join(', ')}, updated_at = NOW()
       WHERE id = :id;
      `,
      { replacements: rep }
    );
    const rows = await sequelize.query(
      `
      SELECT id, name, status, plan_code, billing_email, trial_ends_at,
             auto_disable_overdue, grace_days, seats, staff_count,
             created_at, updated_at
        FROM public.tenants
       WHERE id = :id
       LIMIT 1;
      `,
      { replacements: { id: req.params.id }, type: QueryTypes.SELECT }
    );
    return res.json({ ok: true, tenant: toRowShape(rows[0]) });
  } catch (e) {
    if (isPgMissingTable(e)) return res.status(503).json({ error: 'Tenants table missing' });
    return next(e);
  }
});

/* --------------------------- Suspend / Resume ------------------------------ */
router.post('/:id/suspend', async (req, res, next) => {
  try {
    if (!sequelize) return res.status(503).json({ error: 'DB not available' });
    await sequelize.query(
      `UPDATE public.tenants SET status='suspended', updated_at=NOW() WHERE id=:id;`,
      { replacements: { id: req.params.id } }
    );
    return res.json({ ok: true });
  } catch (e) {
    if (isPgMissingTable(e)) return res.status(503).json({ error: 'Tenants table missing' });
    return next(e);
  }
});

router.post('/:id/resume', async (req, res, next) => {
  try {
    if (!sequelize) return res.status(503).json({ error: 'DB not available' });
    await sequelize.query(
      `UPDATE public.tenants SET status='active', updated_at=NOW() WHERE id=:id;`,
      { replacements: { id: req.params.id } }
    );
    return res.json({ ok: true });
  } catch (e) {
    if (isPgMissingTable(e)) return res.status(503).json({ error: 'Tenants table missing' });
    return next(e);
  }
});

/* --------------------------------- Features -------------------------------- */
router.post('/:id/features', async (req, res, next) => {
  try {
    if (!sequelize) return res.status(503).json({ error: 'DB not available' });
    const id = req.params.id;
    const flags = req.body && typeof req.body === 'object' ? req.body : {};
    const entries = Object.entries(flags);
    if (!entries.length) return res.json({ ok: true });

    await sequelize.transaction(async (t) => {
      for (const [key, enabled] of entries) {
        await sequelize.query(
          `
          INSERT INTO public.feature_flags (tenant_id, key, enabled, created_at, updated_at)
          VALUES (:id, :key, :enabled, NOW(), NOW())
          ON CONFLICT (tenant_id, key) DO UPDATE
            SET enabled = EXCLUDED.enabled,
                updated_at = NOW();
          `,
          { transaction: t, type: QueryTypes.INSERT, replacements: { id, key, enabled: !!enabled } }
        );
      }
    });
    return res.json({ ok: true });
  } catch (e) {
    if (isPgMissingTable(e)) return res.status(503).json({ error: 'feature_flags table missing' });
    return next(e);
  }
});

/* ---------------------------------- Limits --------------------------------- */
router.post('/:id/limits', async (req, res, next) => {
  try {
    if (!sequelize) return res.status(503).json({ error: 'DB not available' });
    const id = req.params.id;
    const limits = req.body && typeof req.body === 'object' ? req.body : {};
    const entries = Object.entries(limits);
    if (!entries.length) return res.json({ ok: true });

    await sequelize.transaction(async (t) => {
      for (const [key, val] of entries) {
        let vi = null, vn = null, vt = null, vj = null;
        if (typeof val === 'number' && Number.isFinite(val)) {
          if (Number.isInteger(val)) vi = val; else vn = val;
        } else if (typeof val === 'string') {
          vt = val;
        } else {
          vj = JSON.stringify(val);
        }
        await sequelize.query(
          `
          INSERT INTO public.tenant_limits
            (tenant_id, key, value_int, value_numeric, value_text, value_json, created_at, updated_at)
          VALUES
            (:id, :key, :vi, :vn, :vt, :vj, NOW(), NOW())
          ON CONFLICT (tenant_id, key) DO UPDATE SET
            value_int     = EXCLUDED.value_int,
            value_numeric = EXCLUDED.value_numeric,
            value_text    = EXCLUDED.value_text,
            value_json    = EXCLUDED.value_json,
            updated_at    = NOW();
          `,
          { transaction: t, type: QueryTypes.INSERT,
            replacements: { id, key, vi, vn, vt, vj } }
        );
      }
    });

    return res.json({ ok: true });
  } catch (e) {
    if (isPgMissingTable(e)) return res.status(503).json({ error: 'tenant_limits table missing' });
    return next(e);
  }
});

/* -------------------------------- Invoices -------------------------------- */
router.get('/:id/invoices', async (req, res, next) => {
  try {
    if (!sequelize) { res.setHeader('X-Total-Count', '0'); return res.json([]); }
    const rows = await sequelize.query(
      `
      SELECT id, number, amount_cents, currency, status, due_date, issued_at, paid_at
        FROM public.invoices
       WHERE tenant_id = :id
       ORDER BY COALESCE(issued_at, created_at) DESC
       LIMIT 250;
      `,
      { replacements: { id: req.params.id }, type: QueryTypes.SELECT }
    );
    res.setHeader('X-Total-Count', String(rows.length || 0));
    return res.json(rows);
  } catch (e) {
    if (isPgMissingTable(e)) { res.setHeader('X-Total-Count', '0'); return res.json([]); }
    return next(e);
  }
});

module.exports = router;
