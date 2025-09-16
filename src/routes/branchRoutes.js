// backend/src/routes/branchRoutes.js
'use strict';
const express = require('express');
const router = express.Router();

let db = {};
try { db = require('../models'); } catch {}
const sequelize = db?.sequelize;
const { Op } = require('sequelize');

const { allow } = (() => { try { return require('../middleware/permissions'); } catch { return {}; } })();
const requireAuth = (req, res, next) => (req.user ? next() : res.status(401).json({ error: 'Unauthorized' }));

const getModel = (name) => {
  const m = db?.[name] || db?.sequelize?.models?.[name];
  if (!m) throw Object.assign(new Error(`Model "${name}" not found`), { status: 500, expose: true });
  return m;
};

const tenantFilter = (model, req) => {
  const key = model?.rawAttributes?.tenant_id ? 'tenant_id'
            : model?.rawAttributes?.tenantId ? 'tenantId'
            : null;
  const tenantId =
    req?.tenant?.id ||
    req?.headers?.['x-tenant-id'] ||
    process.env.DEFAULT_TENANT_ID ||
    null;
  return key && tenantId ? { [key]: tenantId } : {};
};

const isUuid = (v) => typeof v === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);

/* ============================== LIST BRANCHES ============================== */
router.get(
  '/',
  requireAuth,
  allow ? allow('branches:view') : (_req, _res, next) => next(),
  async (req, res, next) => {
    try {
      const Branch = getModel('Branch');
      const where = { ...tenantFilter(Branch, req) };
      if (req.query.q) where.name = { [Op.iLike]: `%${req.query.q}%` };
      const rows = await Branch.findAll({ where, order: [['name', 'ASC']] });
      res.setHeader('X-Total-Count', String(rows.length));
      res.json(rows);
    } catch (e) { next(e); }
  }
);

/* ================================ ADD BRANCH =============================== */
router.post(
  '/',
  requireAuth,
  allow ? allow('branches:manage') : (_req, _res, next) => next(),
  async (req, res, next) => {
    try {
      const Branch = getModel('Branch');
      const rec = { ...req.body, ...tenantFilter(Branch, req) };
      if (!rec.name) return res.status(400).json({ error: 'name is required' });
      const row = await Branch.create(rec);
      res.status(201).json(row);
    } catch (e) { next(e); }
  }
);

/* ================================ UPDATE ================================== */
router.patch(
  '/:id',
  requireAuth,
  allow ? allow('branches:manage') : (_req, _res, next) => next(),
  async (req, res, next) => {
    try {
      const Branch = getModel('Branch');
      const where = { id: req.params.id, ...tenantFilter(Branch, req) };
      const row = await Branch.findOne({ where });
      if (!row) return res.status(404).json({ error: 'Branch not found' });
      await row.update(req.body || {});
      res.json(row);
    } catch (e) { next(e); }
  }
);

/* ================================= DELETE ================================= */
router.delete(
  '/:id',
  requireAuth,
  allow ? allow('branches:manage') : (_req, _res, next) => next(),
  async (req, res, next) => {
    try {
      const Branch = getModel('Branch');
      const where = { id: req.params.id, ...tenantFilter(Branch, req) };
      const n = await Branch.destroy({ where });
      if (!n) return res.status(404).json({ error: 'Branch not found' });
      res.json({ ok: true });
    } catch (e) { next(e); }
  }
);

/* ============================== ASSIGN STAFF =============================== */
/**
 * Writes go to public.user_branches_rt (TABLE).
 * public.user_branches is a VIEW for reads.
 * Types: user_id::uuid, branch_id::int
 */
router.post(
  '/:id/assign-staff',
  requireAuth,
  allow ? allow('branches:assign') : (_req, _res, next) => next(),
  async (req, res, next) => {
    const t = await (sequelize?.transaction?.() ?? { commit: async()=>{}, rollback: async()=>{} });
    try {
      if (!sequelize) throw Object.assign(new Error('DB not initialized'), { status: 500, expose: true });

      const branchId = parseInt(String(req.params.id), 10);
      if (!Number.isFinite(branchId)) {
        return res.status(400).json({ error: 'Branch id must be an integer' });
      }

      const raw = req.body?.userIds;
      const userIds = Array.isArray(raw) ? raw.filter(Boolean) : [];
      if (userIds.length === 0) {
        return res.status(400).json({ error: 'userIds[] required (UUIDs)' });
      }

      const invalid = userIds.filter((id) => !isUuid(id));
      if (invalid.length) {
        return res.status(400).json({
          error: 'All userIds must be UUID strings',
          details: { invalid }
        });
      }

      // Ensure branch exists
      const Branch = getModel('Branch');
      const branch = await Branch.findOne({ where: { id: branchId } });
      if (!branch) return res.status(404).json({ error: 'Branch not found' });

      // Bulk insert: one statement → no cascading 25P02
      const sql = `
        WITH vals(uid) AS (SELECT unnest(:uids::uuid[]))
        INSERT INTO public.user_branches_rt (user_id, branch_id, created_at)
        SELECT uid, :bid::int, NOW() FROM vals
        ON CONFLICT (user_id, branch_id) DO NOTHING
      `;
      await sequelize.query(sql, {
        replacements: { uids: userIds, bid: branchId },
        transaction: t,
      });

      await t.commit();
      res.json({ ok: true, assigned: userIds.length });
    } catch (e) {
      try { await t.rollback(); } catch {}
      const code = e?.original?.code || e?.parent?.code;
      if (code === '22P02') {
        return next(Object.assign(new Error('Invalid ID type — userIds must be UUID and branchId must be integer.'), { status: 400, expose: true, original: e }));
      }
      if (code === '42P01') {
        return next(Object.assign(new Error('Missing table. Ensure public.user_branches_rt exists and migrations ran on this DB.'), { status: 500, expose: true, original: e }));
      }
      return next(e);
    }
  }
);

/* ============================== LIST STAFF ================================= */
router.get(
  '/:id/staff',
  requireAuth,
  allow ? allow('branches:view') : (_req, _res, next) => next(),
  async (req, res, next) => {
    try {
      if (!sequelize) throw Object.assign(new Error('DB not initialized'), { status: 500, expose: true });
      const branchId = parseInt(String(req.params.id), 10);
      if (!Number.isFinite(branchId)) return res.status(400).json({ error: 'Branch id must be an integer' });

      const rows = await sequelize.query(
        `
        SELECT
          u.id,
          COALESCE(u.name, (u."firstName" || ' ' || u."lastName")) AS name,
          u.email,
          u.role
        FROM public.user_branches ub
        JOIN public.users u ON u.id = ub.user_id
        WHERE ub.branch_id = :bid
        ORDER BY name ASC
        `,
        { replacements: { bid: branchId }, type: sequelize.QueryTypes.SELECT }
      );

      res.json({ items: rows || [] });
    } catch (e) { next(e); }
  }
);

/* ================================ REPORT =================================== */
router.get(
  '/:id/report',
  requireAuth,
  allow ? allow('branches:view') : (_req, _res, next) => next(),
  async (req, res, next) => {
    try {
      const from = req.query.from || null;
      const to   = req.query.to || null;
      const id   = Number(req.params.id);

      let staffCount = 0, expenses = 0, loansOut = 0, collections = 0;

      try {
        const r = await sequelize.query(
          `select count(*)::int as c from public.user_branches where branch_id = $1`,
          { bind: [id], type: sequelize.QueryTypes.SELECT }
        );
        staffCount = r?.[0]?.c || 0;
      } catch {}

      try {
        const r = await sequelize.query(
          `
            select coalesce(sum(amount),0)::numeric as total
            from public.expenses
            where branch_id = $1
              and ($2::date is null or date >= $2::date)
              and ($3::date is null or date <= $3::date)
          `,
          { bind: [id, from, to], type: sequelize.QueryTypes.SELECT }
        );
        expenses = Number(r?.[0]?.total || 0);
      } catch {}

      try {
        const r = await sequelize.query(
          `
            select coalesce(sum(principal),0)::numeric as total
            from public.loans
            where branch_id = $1
              and status in ('active','closed')
              and ($2::date is null or disbursed_at >= $2::date)
              and ($3::date is null or disbursed_at <= $3::date)
          `,
          { bind: [id, from, to], type: sequelize.QueryTypes.SELECT }
        );
        loansOut = Number(r?.[0]?.total || 0);
      } catch {}

      try {
        const r = await sequelize.query(
          `
            select coalesce(sum(amount),0)::numeric as total
            from public.repayments
            where branch_id = $1
              and ($2::date is null or paid_at >= $2::date)
              and ($3::date is null or paid_at <= $3::date)
          `,
          { bind: [id, from, to], type: sequelize.QueryTypes.SELECT }
        );
        collections = Number(r?.[0]?.total || 0);
      } catch {}

      res.json({
        branchId: id,
        range: { from, to },
        kpis: { staffCount, expenses, loansOut, collections },
      });
    } catch (e) { next(e); }
  }
);

module.exports = router;
