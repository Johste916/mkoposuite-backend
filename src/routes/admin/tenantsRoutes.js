'use strict';

const express = require('express');
const router = express.Router();
const { sequelize } = require('../../models');
const { QueryTypes } = require('sequelize');

/* ----------------------------------------------------------------------------
   Helpers
----------------------------------------------------------------------------- */
const CACHE = { cols: null, ts: 0 };
const ONE_MIN = 60 * 1000;

const isMissingTable = (e) =>
  e?.original?.code === '42P01' || e?.parent?.code === '42P01';

async function getTenantColumns() {
  if (CACHE.cols && Date.now() - CACHE.ts < ONE_MIN) return CACHE.cols;
  const rows = await sequelize.query(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_schema='public' AND table_name='tenants'`,
    { type: QueryTypes.SELECT }
  );
  CACHE.cols = new Set(rows.map(r => r.column_name));
  CACHE.ts = Date.now();
  return CACHE.cols;
}

function col(cols, name, alias = name) {
  return cols.has(name) ? `t.${name}` : `NULL AS "${alias}"`;
}

function toApi(row) {
  const today = new Date().toISOString().slice(0, 10);
  const trialLeft = row.trial_ends_at
    ? Math.ceil((Date.parse(row.trial_ends_at) - Date.parse(today)) / 86400000)
    : null;

  const planCode = (row.plan_code || 'basic').toLowerCase();
  return {
    id: row.id,
    name: row.name,
    status: row.status || 'trial',
    planCode,
    planLabel: planCode,
    trialEndsAt: row.trial_ends_at || null,
    trialDaysLeft: trialLeft,
    autoDisableOverdue: !!row.auto_disable_overdue,
    graceDays: Number.isFinite(Number(row.grace_days)) ? Number(row.grace_days) : 7,
    billingEmail: row.billing_email || '',
    seats: row.seats == null ? null : Number(row.seats),
    staffCount: row.staff_count == null ? 0 : Number(row.staff_count),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function buildWhere(q, cols) {
  const where = [];
  const repl = {};
  if (q && String(q).trim()) {
    const likeCols = ['name', 'plan_code', 'status'];
    if (cols.has('billing_email')) likeCols.push('billing_email');
    const parts = likeCols.map(c => `t.${c} ILIKE :q`);
    where.push(`(${parts.join(' OR ')})`);
    repl.q = `%${String(q).trim()}%`;
  }
  const sql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  return { sql, repl };
}

function selectBase(cols, withStaff = true) {
  return `
    SELECT
      t.id,
      t.name,
      ${col(cols, 'status')},
      ${col(cols, 'plan_code')},
      ${col(cols, 'trial_ends_at')},
      ${col(cols, 'auto_disable_overdue')},
      ${col(cols, 'grace_days')},
      ${col(cols, 'billing_email')},
      ${col(cols, 'seats')},
      ${withStaff
        ? `COALESCE(${cols.has('staff_count') ? 't.staff_count' : 'NULL'}, tu.staff_count, 0)::int AS staff_count`
        : `0::int AS staff_count`
      },
      ${col(cols, 'created_at')},
      ${col(cols, 'updated_at')}
    FROM public.tenants t
    ${withStaff ? `
      LEFT JOIN (
        SELECT tenant_id, COUNT(*)::int AS staff_count
        FROM public.tenant_users
        GROUP BY tenant_id
      ) tu ON tu.tenant_id = t.id
    ` : ''}
  `;
}

/* ----------------------------------------------------------------------------
   Routes
----------------------------------------------------------------------------- */

/** GET /api/admin/tenants — list */
router.get('/', async (req, res, next) => {
  try {
    const limit = Math.max(0, Math.min(200, Number(req.query.limit) || 50));
    const offset = Math.max(0, Number(req.query.offset) || 0);
    const cols = await getTenantColumns();
    const { sql: whereSql, repl } = buildWhere(req.query.q, cols);

    const [{ c: total }] = await sequelize.query(
      `SELECT COUNT(*)::int AS c FROM public.tenants t ${whereSql}`,
      { replacements: repl, type: QueryTypes.SELECT }
    );

    let rows;
    try {
      rows = await sequelize.query(
        `${selectBase(cols, true)} ${whereSql} ORDER BY t.name ASC LIMIT :limit OFFSET :offset`,
        { replacements: { ...repl, limit, offset }, type: QueryTypes.SELECT }
      );
    } catch (e) {
      // If tenant_users table is missing, retry without the join
      if (!isMissingTable(e)) throw e;
      rows = await sequelize.query(
        `${selectBase(cols, false)} ${whereSql} ORDER BY t.name ASC LIMIT :limit OFFSET :offset`,
        { replacements: { ...repl, limit, offset }, type: QueryTypes.SELECT }
      );
    }

    res.setHeader('X-Total-Count', String(total));
    res.json(rows.map(toApi));
  } catch (e) { next(e); }
});

/** GET /api/admin/tenants/stats — for top widgets */
router.get('/stats', async (_req, res, next) => {
  try {
    const cols = await getTenantColumns();
    let items;
    try {
      items = await sequelize.query(
        `
        SELECT
          t.id,
          COALESCE(${cols.has('staff_count') ? 't.staff_count' : 'NULL'}, tu.staff_count, 0)::int AS "staffCount",
          ${cols.has('seats') ? 't.seats' : 'NULL'} AS "seats"
        FROM public.tenants t
        LEFT JOIN (
          SELECT tenant_id, COUNT(*)::int AS staff_count
          FROM public.tenant_users
          GROUP BY tenant_id
        ) tu ON tu.tenant_id = t.id
        `,
        { type: QueryTypes.SELECT }
      );
    } catch (e) {
      if (!isMissingTable(e)) throw e;
      // Fallback: no tenant_users table
      items = await sequelize.query(
        `
        SELECT
          t.id,
          0::int AS "staffCount",
          ${cols.has('seats') ? 't.seats' : 'NULL'} AS "seats"
        FROM public.tenants t
        `,
        { type: QueryTypes.SELECT }
      );
    }
    res.json({ items });
  } catch (e) { next(e); }
});

/** GET /api/admin/tenants/:id — read */
router.get('/:id', async (req, res, next) => {
  try {
    const cols = await getTenantColumns();
    let row;
    try {
      [row] = await sequelize.query(
        `${selectBase(cols, true)} WHERE t.id = :id LIMIT 1`,
        { replacements: { id: req.params.id }, type: QueryTypes.SELECT }
      );
    } catch (e) {
      if (!isMissingTable(e)) throw e;
      [row] = await sequelize.query(
        `${selectBase(cols, false)} WHERE t.id = :id LIMIT 1`,
        { replacements: { id: req.params.id }, type: QueryTypes.SELECT }
      );
    }
    if (!row) return res.status(404).json({ error: 'Tenant not found' });
    res.json(toApi(row));
  } catch (e) { next(e); }
});

/** PATCH /api/admin/tenants/:id — update */
router.patch('/:id', async (req, res, next) => {
  try {
    const cols = await getTenantColumns();
    const id = req.params.id;
    const b = req.body || {};

    const sets = [];
    const r = { id };

    if (typeof b.name === 'string' && cols.has('name')) {
      sets.push('name = :name'); r.name = b.name.trim();
    }
    if (typeof b.planCode === 'string' && cols.has('plan_code')) {
      sets.push('plan_code = :plan_code'); r.plan_code = b.planCode.toLowerCase();
    }
    if (typeof b.status === 'string' && cols.has('status')) {
      sets.push('status = :status'); r.status = b.status.trim().toLowerCase();
    }
    if ('trialEndsAt' in b && cols.has('trial_ends_at')) {
      sets.push('trial_ends_at = :trial_ends_at');
      r.trial_ends_at = b.trialEndsAt ? String(b.trialEndsAt).slice(0, 10) : null;
    }
    if (typeof b.billingEmail === 'string' && cols.has('billing_email')) {
      sets.push('billing_email = :billing_email'); r.billing_email = b.billingEmail.trim();
    }
    if ('seats' in b && cols.has('seats') && (b.seats === null || Number.isFinite(Number(b.seats)))) {
      sets.push('seats = :seats'); r.seats = b.seats === null ? null : Number(b.seats);
    }
    if (typeof b.autoDisableOverdue === 'boolean' && cols.has('auto_disable_overdue')) {
      sets.push('auto_disable_overdue = :auto_disable_overdue'); r.auto_disable_overdue = b.autoDisableOverdue;
    }
    if (Number.isFinite(Number(b.graceDays)) && cols.has('grace_days')) {
      sets.push('grace_days = :grace_days'); r.grace_days = Math.max(0, Math.min(90, Number(b.graceDays)));
    }

    if (sets.length) {
      await sequelize.query(
        `UPDATE public.tenants SET ${sets.join(', ')}, updated_at = now() WHERE id = :id`,
        { replacements: r, type: QueryTypes.UPDATE }
      );
    }

    // fresh read
    let row;
    try {
      [row] = await sequelize.query(
        `${selectBase(cols, true)} WHERE t.id = :id LIMIT 1`,
        { replacements: { id }, type: QueryTypes.SELECT }
      );
    } catch (e) {
      if (!isMissingTable(e)) throw e;
      [row] = await sequelize.query(
        `${selectBase(cols, false)} WHERE t.id = :id LIMIT 1`,
        { replacements: { id }, type: QueryTypes.SELECT }
      );
    }

    if (!row) return res.status(404).json({ error: 'Tenant not found' });
    res.json({ ok: true, tenant: toApi(row) });
  } catch (e) { next(e); }
});

/** GET /api/admin/tenants/:id/invoices */
router.get('/:id/invoices', async (req, res, next) => {
  const id = req.params.id;
  try {
    try {
      const rows = await sequelize.query(
        `
        SELECT id, number, amount_cents, currency, status, due_date, issued_at, paid_at
        FROM public.invoices
        WHERE tenant_id = :id
        ORDER BY COALESCE(issued_at, created_at) DESC
        LIMIT 250
        `,
        { replacements: { id }, type: QueryTypes.SELECT }
      );
      return res.json({ invoices: rows });
    } catch (e) {
      if (isMissingTable(e)) return res.json({ invoices: [] });
      throw e;
    }
  } catch (e) { next(e); }
});

/** POST /api/admin/tenants/:id/invoices/sync — placeholder */
router.post('/:id/invoices/sync', async (_req, res) => res.json({ ok: true }));

module.exports = router;
