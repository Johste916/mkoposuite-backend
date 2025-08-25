'use strict';
const { Op } = require('sequelize');
const { sequelize } = require('../models');

const getModel = (n) => {
  const m = sequelize?.models?.[n];
  if (!m) throw Object.assign(new Error(`Model "${n}" not found`), { status: 500, expose: true });
  return m;
};

const hasAttr = (Model, attr) => Boolean(Model?.rawAttributes?.[attr]);
const pick = (Model, body = {}) =>
  !Model?.rawAttributes ? body : Object.fromEntries(Object.entries(body).filter(([k]) => Model.rawAttributes[k]));
const toDate = (v) => {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

const getTenantId = (req) => req.user?.tenantId || req.headers['x-tenant-id'] || null;
const getActorId  = (req) => req.user?.id || req.headers['x-user-id'] || null;

const buildWhere = (Model, { q, dateFrom, dateTo, branchId }) => {
  const where = {};
  if (q) {
    const fields = ['type', 'note', 'vendor', 'reference'].filter((f) => hasAttr(Model, f));
    if (fields.length) where[Op.or] = fields.map((f) => ({ [f]: { [Op.iLike]: `%${q}%` } }));
  }
  if (branchId && hasAttr(Model, 'branchId')) where.branchId = branchId;

  const df = toDate(dateFrom);
  const dt = toDate(dateTo);
  if (hasAttr(Model, 'date') && (df || dt)) {
    where.date = {};
    if (df) where.date[Op.gte] = df;
    if (dt) where.date[Op.lte] = dt;
  }
  return where;
};

exports.list = async (req, res) => {
  try {
    const Model = getModel('Expense');
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ error: 'Tenant context required' });

    const page  = Math.max(parseInt(req.query.page  || '1', 10), 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit || '20', 10), 1), 200);
    const offset = (page - 1) * limit;

    const where = {
      tenantId,
      ...buildWhere(Model, {
        q: req.query.q,
        dateFrom: req.query.dateFrom,
        dateTo: req.query.dateTo,
        branchId: req.query.branchId,
      }),
    };

    const { rows, count } = await Model.findAndCountAll({
      where,
      limit,
      offset,
      order: [['date', 'DESC'], ['createdAt', 'DESC']],
    });

    return res.json({ data: rows, pagination: { page, limit, total: count } });
  } catch (err) {
    const status = err.status || 500;
    return res.status(status).json({ error: err.expose ? err.message : 'Internal Server Error' });
  }
};

exports.get = async (req, res) => {
  try {
    const Model = getModel('Expense');
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ error: 'Tenant context required' });

    const row = await Model.findOne({ where: { id: req.params.id, tenantId } });
    if (!row) return res.status(404).json({ error: 'Not found' });
    return res.json(row);
  } catch (err) {
    const status = err.status || 500;
    return res.status(status).json({ error: err.expose ? err.message : 'Internal Server Error' });
  }
};

exports.create = async (req, res) => {
  try {
    const Model = getModel('Expense');
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ error: 'Tenant context required' });

    const payload = pick(Model, req.body);
    payload.tenantId = tenantId;

    // normalize/validate
    if (!payload.date) return res.status(400).json({ error: 'date is required' });
    if (payload.amount == null || payload.amount === '') return res.status(400).json({ error: 'amount is required' });

    const uid = getActorId(req);
    if (uid && hasAttr(Model, 'createdBy')) payload.createdBy = uid;
    if (uid && hasAttr(Model, 'updatedBy')) payload.updatedBy = uid;

    const created = await Model.create(payload);
    return res.status(201).json(created);
  } catch (err) {
    const status = err.status || 500;
    return res.status(status).json({ error: err.expose ? err.message : 'Internal Server Error' });
  }
};

exports.update = async (req, res) => {
  try {
    const Model = getModel('Expense');
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ error: 'Tenant context required' });

    const row = await Model.findOne({ where: { id: req.params.id, tenantId } });
    if (!row) return res.status(404).json({ error: 'Not found' });

    const patch = pick(Model, req.body);
    const uid = getActorId(req);
    if (uid && hasAttr(Model, 'updatedBy')) patch.updatedBy = uid;

    await row.update(patch);
    return res.json(row);
  } catch (err) {
    const status = err.status || 500;
    return res.status(status).json({ error: err.expose ? err.message : 'Internal Server Error' });
  }
};

exports.remove = async (req, res) => {
  try {
    const Model = getModel('Expense');
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ error: 'Tenant context required' });

    const row = await Model.findOne({ where: { id: req.params.id, tenantId } });
    if (!row) return res.status(404).json({ error: 'Not found' });

    await row.destroy();
    return res.json({ ok: true });
  } catch (err) {
    const status = err.status || 500;
    return res.status(status).json({ error: err.expose ? err.message : 'Internal Server Error' });
  }
};
