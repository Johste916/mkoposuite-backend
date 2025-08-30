'use strict';
const { Op, Sequelize } = require('sequelize');

let db = {};
try { db = require('../models'); } catch {}
const getModel = (name) => {
  const m = db?.[name] || db?.sequelize?.models?.[name];
  if (!m) throw Object.assign(new Error(`Model "${name}" not found`), { status: 500, expose: true });
  return m;
};
const tenantFilter = (model, req) => {
  const key = model?.rawAttributes?.tenantId ? 'tenantId'
            : model?.rawAttributes?.tenant_id ? 'tenant_id' : null;
  const tenantId =
    req?.tenant?.id ||
    req?.headers?.['x-tenant-id'] ||
    process.env.DEFAULT_TENANT_ID ||
    null;
  return key && tenantId ? { [key]: tenantId } : {};
};

// --- Helpers ---------------------------------------------------------------
async function safeCount(table, whereSql, replacements = {}) {
  const sequelize = db.sequelize;
  try {
    const [rows] = await sequelize.query(
      `select count(*)::bigint as n from ${table} ${whereSql || ''}`, { replacements }
    );
    return Number(rows?.[0]?.n || 0);
  } catch { return 0; }
}
async function safeSum(table, expr, whereSql, replacements = {}) {
  const sequelize = db.sequelize;
  try {
    const [rows] = await sequelize.query(
      `select coalesce(sum(${expr}),0)::numeric as s from ${table} ${whereSql || ''}`, { replacements }
    );
    return Number(rows?.[0]?.s || 0);
  } catch { return 0; }
}

// --- CRUD -------------------------------------------------------------------
exports.list = async (req, res, next) => {
  try {
    const Branch = getModel('Branch');
    const where = { ...tenantFilter(Branch, req) };
    if (req.query.status) where.status = req.query.status;
    const rows = await Branch.findAll({ where, order: [['name', 'ASC']] });
    res.json({ items: rows });
  } catch (e) { next(e); }
};

exports.create = async (req, res, next) => {
  try {
    const Branch = getModel('Branch');
    const rec = {
      name: req.body?.name,
      code: req.body?.code,
      email: req.body?.email || null,
      phone: req.body?.phone || null,
      address: req.body?.address || null,
      status: req.body?.status || 'active',
      geoLat: req.body?.geoLat || null,
      geoLng: req.body?.geoLng || null,
      ...tenantFilter(Branch, req),
    };
    if (!rec.name || !rec.code) {
      return res.status(400).json({ error: 'name and code are required' });
    }
    const row = await Branch.create(rec);
    res.status(201).json(row);
  } catch (e) { next(e); }
};

exports.getOne = async (req, res, next) => {
  try {
    const Branch = getModel('Branch');
    const where = { id: req.params.id, ...tenantFilter(Branch, req) };
    const row = await Branch.findOne({ where });
    if (!row) return res.status(404).json({ error: 'Branch not found' });
    res.json(row);
  } catch (e) { next(e); }
};

exports.update = async (req, res, next) => {
  try {
    const Branch = getModel('Branch');
    const where = { id: req.params.id, ...tenantFilter(Branch, req) };
    const row = await Branch.findOne({ where });
    if (!row) return res.status(404).json({ error: 'Branch not found' });
    await row.update(req.body || {});
    res.json(row);
  } catch (e) { next(e); }
};

exports.remove = async (req, res, next) => {
  try {
    const Branch = getModel('Branch');
    const where = { id: req.params.id, ...tenantFilter(Branch, req) };
    const n = await Branch.destroy({ where });
    if (!n) return res.status(404).json({ error: 'Branch not found' });
    res.json({ ok: true });
  } catch (e) { next(e); }
};

// --- Assignments ------------------------------------------------------------
// Staff (user <-> branch)
exports.listStaff = async (req, res, next) => {
  try {
    const sequelize = db.sequelize;
    const branchId = Number(req.params.id);
    const tenantId = req?.headers?.['x-tenant-id'] || process.env.DEFAULT_TENANT_ID || null;
    const [rows] = await sequelize.query(`
      select u.id, coalesce(u.name, (u."firstName"||' '||u."lastName")) as name, u.email, u.role
      from public.users u
      join public.user_branches ub on ub.user_id = u.id
      where ub.branch_id = :branchId
        ${tenantId ? 'and coalesce(ub.tenant_id, :tenantId) = :tenantId' : ''}
      order by name asc
    `, { replacements: { branchId, tenantId } });
    res.json({ items: rows || [] });
  } catch (e) { next(e); }
};

exports.assignStaff = async (req, res, next) => {
  try {
    const sequelize = db.sequelize;
    const branchId = Number(req.params.id);
    const userIds = Array.isArray(req.body?.userIds) ? req.body.userIds : [];
    const tenantId = req?.headers?.['x-tenant-id'] || process.env.DEFAULT_TENANT_ID || null;

    if (!userIds.length) return res.status(400).json({ error: 'userIds[] required' });

    await sequelize.transaction(async (t) => {
      for (const uid of userIds) {
        await sequelize.query(`
          insert into public.user_branches (user_id, branch_id, tenant_id)
          values (:uid, :branchId, :tenantId)
          on conflict (user_id, branch_id) do update set tenant_id = excluded.tenant_id
        `, { replacements: { uid, branchId, tenantId }, transaction: t });
      }
    });

    res.status(201).json({ ok: true });
  } catch (e) { next(e); }
};

exports.unassignStaff = async (req, res, next) => {
  try {
    const sequelize = db.sequelize;
    const branchId = Number(req.params.id);
    const userId = Number(req.params.userId);
    await sequelize.query(`delete from public.user_branches where user_id = :userId and branch_id = :branchId`,
      { replacements: { userId, branchId } });
    res.json({ ok: true });
  } catch (e) { next(e); }
};

// Borrowers (borrower <-> branch)
exports.listBorrowers = async (req, res, next) => {
  try {
    const sequelize = db.sequelize;
    const branchId = Number(req.params.id);
    const [rows] = await sequelize.query(`
      select b.id, b.name, b.phone
      from public.borrowers b
      join public.borrower_branches bb on bb.borrower_id = b.id
      where bb.branch_id = :branchId
      order by b.name asc
    `, { replacements: { branchId } });
    res.json({ items: rows || [] });
  } catch (e) { next(e); }
};

exports.assignBorrowers = async (req, res, next) => {
  try {
    const sequelize = db.sequelize;
    const branchId = Number(req.params.id);
    const borrowerIds = Array.isArray(req.body?.borrowerIds) ? req.body.borrowerIds : [];
    const tenantId = req?.headers?.['x-tenant-id'] || process.env.DEFAULT_TENANT_ID || null;
    if (!borrowerIds.length) return res.status(400).json({ error: 'borrowerIds[] required' });

    await sequelize.transaction(async (t) => {
      for (const bid of borrowerIds) {
        await sequelize.query(`
          insert into public.borrower_branches (borrower_id, branch_id, tenant_id)
          values (:bid, :branchId, :tenantId)
          on conflict (borrower_id, branch_id) do nothing
        `, { replacements: { bid, branchId, tenantId }, transaction: t });
      }
    });

    res.status(201).json({ ok: true });
  } catch (e) { next(e); }
};

exports.unassignBorrower = async (req, res, next) => {
  try {
    const sequelize = db.sequelize;
    const branchId = Number(req.params.id);
    const borrowerId = Number(req.params.borrowerId);
    await sequelize.query(`
      delete from public.borrower_branches where borrower_id = :borrowerId and branch_id = :branchId
    `, { replacements: { borrowerId, branchId } });
    res.json({ ok: true });
  } catch (e) { next(e); }
};

// --- KPIs / Stats -----------------------------------------------------------
exports.stats = async (req, res, next) => {
  try {
    const branchId = Number(req.params.id);
    const from = req.query.from || null;
    const to   = req.query.to   || null;

    // time filter snippets (used by safeSum/safeCount)
    const between = (col) =>
      from && to ? ` and ${col} >= :from and ${col} < (:to::date + interval '1 day')`
      : from     ? ` and ${col} >= :from`
      : to       ? ` and ${col} < (:to::date + interval '1 day')`
                 : '';

    // staff count
    const staffCount = await safeCount('public.user_branches ub', 'where ub.branch_id = :branchId', { branchId });

    // borrowers count
    const borrowers = await safeCount('public.borrower_branches bb', 'where bb.branch_id = :branchId', { branchId });

    // portfolio & disbursements, repayments (tolerate missing tables)
    const disbursed = await safeSum(
      'public.loans l',
      'l.principal_amount',
      `where l.branch_id = :branchId ${between('l.disbursement_date')}`,
      { branchId, from, to }
    );
    const collected = await safeSum(
      'public.repayments r',
      'r.amount',
      `where r.branch_id = :branchId ${between('r.date')}`,
      { branchId, from, to }
    );
    const expenses  = await safeSum(
      'public.expenses e',
      'e.amount',
      `where e.branch_id = :branchId ${between('e.date')}`,
      { branchId, from, to }
    );

    res.json({
      staffCount, borrowers, disbursed, collected, expenses,
      period: { from, to }
    });
  } catch (e) { next(e); }
};
