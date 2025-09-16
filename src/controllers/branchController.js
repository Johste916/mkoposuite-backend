// backend/src/controllers/branchController.js
'use strict';
const { Op } = require('sequelize');

let db = {};
try { db = require('../models'); } catch {}
const getModel = (name) => {
  const m = db?.[name] || db?.sequelize?.models?.[name];
  if (!m) throw Object.assign(new Error(`Model "${name}" not found`), { status: 500, expose: true });
  return m;
};
const tenantFilter = (model, req) => {
  const hasTenant =
    model?.rawAttributes?.tenantId || model?.rawAttributes?.tenant_id || model?.rawAttributes?.tenant_id;
  const tenantId =
    req?.tenant?.id ||
    req?.headers?.['x-tenant-id'] ||
    process.env.DEFAULT_TENANT_ID ||
    null;
  return hasTenant && tenantId ? { tenantId } : {};
};

const clean = (v) => (typeof v === 'string' ? v.trim() : v);
const toNull = (v) => {
  if (v === undefined || v === null) return null;
  if (typeof v === 'string' && v.trim() === '') return null;
  return v;
};

/* ------------------------------- LIST ------------------------------------- */
exports.list = async (req, res, next) => {
  try {
    const Branch = getModel('Branch');
    const where = { ...tenantFilter(Branch, req) };
    if (req.query.q) where.name = { [Op.iLike]: `%${String(req.query.q).trim()}%` };
    const rows = await Branch.findAll({ where, order: [['name', 'ASC']] });
    res.setHeader('X-Total-Count', String(rows.length));
    res.json(rows);
  } catch (e) { next(e); }
};

/* ------------------------------ CREATE ------------------------------------ */
exports.create = async (req, res, next) => {
  try {
    const Branch = getModel('Branch');

    const rec = {
      name: clean(req.body?.name),
      code: String(req.body?.code ?? '').trim(),   // keep as string
      phone: toNull(clean(req.body?.phone)),
      address: toNull(clean(req.body?.address)),
      managerId: toNull(clean(req.body?.managerId)),
      ...tenantFilter(Branch, req),
    };

    if (!rec.name || !rec.code) {
      return res.status(400).json({ error: 'name and code are required' });
    }

    const row = await Branch.create(rec);
    res.status(201).json(row);
  } catch (e) { next(e); }
};

/* ------------------------------- GET ONE ---------------------------------- */
exports.getOne = async (req, res, next) => {
  try {
    const Branch = getModel('Branch');
    const id = Number(String(req.params.id || '').trim());
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid branch id' });

    const where = { id, ...tenantFilter(Branch, req) };
    const row = await Branch.findOne({ where });
    if (!row) return res.status(404).json({ error: 'Branch not found' });
    res.json(row);
  } catch (e) { next(e); }
};

/* ------------------------------- UPDATE ----------------------------------- */
exports.update = async (req, res, next) => {
  try {
    const Branch = getModel('Branch');
    const id = Number(String(req.params.id || '').trim());
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid branch id' });

    const where = { id, ...tenantFilter(Branch, req) };
    const row = await Branch.findOne({ where });
    if (!row) return res.status(404).json({ error: 'Branch not found' });

    const patch = {
      name: clean(req.body?.name),
      code: req.body?.code !== undefined ? String(req.body.code).trim() : undefined,
      phone: toNull(clean(req.body?.phone)),
      address: toNull(clean(req.body?.address)),
      managerId: toNull(clean(req.body?.managerId)),
    };

    await row.update(patch);
    res.json(row);
  } catch (e) { next(e); }
};

/* ------------------------------- DELETE ----------------------------------- */
exports.remove = async (req, res, next) => {
  try {
    const Branch = getModel('Branch');
    const id = Number(String(req.params.id || '').trim());
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid branch id' });

    const where = { id, ...tenantFilter(Branch, req) };
    const n = await Branch.destroy({ where });
    if (!n) return res.status(404).json({ error: 'Branch not found' });
    res.json({ ok: true });
  } catch (e) { next(e); }
};

/* --------------------------- STAFF ASSIGNMENTS ----------------------------- */
exports.listStaff = async (req, res, next) => {
  try {
    const sequelize = db.sequelize;
    const branchId = Number(String(req.params.id || '').trim());
    if (!Number.isFinite(branchId)) return res.status(400).json({ error: 'Invalid branch id' });

    const rows = await sequelize.query(
      `
      select u.id, coalesce(u.name, (u."firstName"||' '||u."lastName")) as name, u.email, u.role
      from public.user_branches ub
      join public.Users u on u.id = ub.user_id
      where ub.branch_id = $1
      order by name asc
      `,
      { bind: [branchId], type: sequelize.QueryTypes.SELECT }
    );
    res.json({ items: rows || [] });
  } catch (e) { next(e); }
};

exports.assignStaff = async (req, res, next) => {
  const t = await (db.sequelize?.transaction?.() ?? { commit: async()=>{}, rollback: async()=>{} });
  try {
    const sequelize = db.sequelize;
    const branchId = Number(String(req.params.id || '').trim());
    if (!Number.isFinite(branchId)) return res.status(400).json({ error: 'Invalid branch id' });

    const userIds = Array.isArray(req.body?.userIds) ? req.body.userIds.filter(Boolean) : [];
    if (!userIds.length) return res.status(400).json({ error: 'userIds[] required' });

    const tenantId = req?.headers?.['x-tenant-id'] || process.env.DEFAULT_TENANT_ID || null;

    for (const uid of userIds) {
      await sequelize.query(
        `
          insert into public.user_branches (user_id, branch_id, tenant_id)
          values ($1, $2, $3)
          on conflict (user_id, branch_id)
          do update set tenant_id = excluded.tenant_id
        `,
        { bind: [uid, branchId, tenantId], transaction: t }
      );
    }

    await t.commit();
    res.json({ ok: true, assigned: userIds.length });
  } catch (e) {
    await t.rollback();
    next(e);
  }
};

exports.unassignStaff = async (req, res, next) => {
  try {
    const sequelize = db.sequelize;
    const branchId = Number(String(req.params.id || '').trim());
    const userId = String(req.params.userId || '').trim();
    if (!Number.isFinite(branchId) || !userId) {
      return res.status(400).json({ error: 'Invalid ids' });
    }
    await sequelize.query(
      `delete from public.user_branches where user_id = $1 and branch_id = $2`,
      { bind: [userId, branchId] }
    );
    res.json({ ok: true });
  } catch (e) { next(e); }
};
