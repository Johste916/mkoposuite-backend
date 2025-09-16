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

/** Safe tenant filter (same logic used elsewhere) */
function safeTenantFilter(model, req) {
  if (!model?.rawAttributes) return {};
  const attrKey =
    model.rawAttributes.tenantId ? 'tenantId' :
    model.rawAttributes.tenant_id ? 'tenant_id' :
    null;
  if (!attrKey) return {};

  const rawTypeKey = model.rawAttributes[attrKey]?.type?.key || '';
  const wantsNumber = /INT|DECIMAL|BIGINT|FLOAT|DOUBLE|NUMERIC/.test(rawTypeKey);

  const incoming =
    req?.tenant?.id ??
    req?.headers?.['x-tenant-id'] ??
    process.env.DEFAULT_TENANT_ID ??
    null;

  if (incoming == null || incoming === '') return {};

  const isNumeric = typeof incoming === 'number' || /^\d+$/.test(String(incoming));

  if (wantsNumber) {
    if (!isNumeric) return {};
    return { [attrKey]: Number(incoming) };
  } else {
    return { [attrKey]: String(incoming) };
  }
}

const isUuid = (v) => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);

/* ============================== LIST BRANCHES ============================== */
router.get(
  '/',
  requireAuth,
  allow ? allow('branches:view') : (_req, _res, next) => next(),
  async (req, res, next) => {
    try {
      const Branch = getModel('Branch');
      const where = { ...safeTenantFilter(Branch, req) };
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
      const rec = { ...req.body, ...safeTenantFilter(Branch, req) };
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
      const where = { id: req.params.id, ...safeTenantFilter(Branch, req) };
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
      const where = { id: req.params.id, ...safeTenantFilter(Branch, req) };
      const n = await Branch.destroy({ where });
      if (!n) return res.status(404).json({ error: 'Branch not found' });
      res.json({ ok: true });
    } catch (e) { next(e); }
  }
);

/* ============================== ASSIGN STAFF =============================== */
router.post(
  '/:id/assign-staff',
  requireAuth,
  allow ? allow('branches:assign') : (_req, _res, next) => next(),
  async (req, res, next) => {
    const t = await (sequelize?.transaction?.() ?? { commit: async()=>{}, rollback: async()=>{} });
    try {
      const { userIds } = req.body || {};
      if (!Array.isArray(userIds) || userIds.length === 0) {
        return res.status(400).json({ error: 'userIds[] required' });
      }

      const branchId = Number(req.params.id);
      const good = [];
      const skipped = [];

      for (const raw of userIds) {
        const uid = String(raw);
        if (isUuid(uid)) good.push(uid);
        else skipped.push(uid);
      }

      for (const uid of good) {
        await sequelize.query(
          `
          insert into public.user_branches_rt (user_id, branch_id)
          values ($1::uuid, $2::int)
          on conflict (user_id, branch_id) do nothing
          `,
          { bind: [uid, branchId], transaction: t }
        );
      }

      await t.commit();
      return res.json({ ok: true, assigned: good.length, skipped });
    } catch (e) {
      await t.rollback();
      next(e);
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
      const id = Number(req.params.id);
      const rows = await sequelize.query(
        `
        select u.id, coalesce(u.name, (u."firstName" || ' ' || u."lastName")) as name, u.email, u.role
        from public.user_branches ub
        join public.users u on u.id = ub.user_id
        where ub.branch_id = $1
        order by name asc
        `,
        { bind: [id], type: sequelize.QueryTypes.SELECT }
      );
      res.json({ items: rows });
    } catch (e) { next(e); }
  }
);

/* ============================== UNASSIGN STAFF ============================= */
router.delete(
  '/:id/staff/:userId',
  requireAuth,
  allow ? allow('branches:assign') : (_req, _res, next) => next(),
  async (req, res, next) => {
    try {
      const branchId = Number(req.params.id);
      const userId = String(req.params.userId);
      if (!isUuid(userId)) return res.json({ ok: true, skipped: userId });

      await sequelize.query(
        `delete from public.user_branches_rt where user_id = $1::uuid and branch_id = $2::int`,
        { bind: [userId, branchId] }
      );
      res.json({ ok: true });
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
