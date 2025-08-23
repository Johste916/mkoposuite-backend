'use strict';

const { Op } = require('sequelize');
const { sequelize } = require('../models');
const { Parser: CsvParser } = require('json2csv');

const getModel = (n) => {
  const m = sequelize?.models?.[n];
  if (!m) throw Object.assign(new Error(`Model "${n}" not found`), { status: 500, expose: true });
  return m;
};
const hasAttr = (M, k) => !!M?.rawAttributes?.[k];
const pick = (M, body = {}) =>
  !M.rawAttributes ? body : Object.fromEntries(Object.entries(body).filter(([k]) => M.rawAttributes[k]));

const actorId = (req) => req.user?.id || req.headers['x-user-id'] || null;

const buildWhere = (M, q, status, category) => {
  const where = {};
  if (q) {
    const fields = ['itemName', 'category', 'model', 'serialNumber', 'location', 'notes']
      .filter(f => hasAttr(M, f));
    if (fields.length) where[Op.or] = fields.map(f => ({ [f]: { [Op.iLike]: `%${q}%` } }));
  }
  if (status && hasAttr(M, 'status')) where.status = status;
  if (category && hasAttr(M, 'category')) where.category = { [Op.iLike]: category };
  return where;
};

const sendCsv = (res, rows) => {
  const data = rows.map(r => r.toJSON ? r.toJSON() : r);
  const fields = Object.keys(data[0] || {});
  const csv = new CsvParser({ fields }).parse(data);
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="collaterals.csv"');
  res.status(200).send(csv);
};

// GET /api/collateral
exports.list = async (req, res) => {
  try {
    const M = getModel('Collateral');

    const page  = Math.max(parseInt(req.query.page  || '1', 10), 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit || '20', 10), 1), 200);
    const offset = (page - 1) * limit;
    const order = [['createdAt', 'DESC']];

    const where = buildWhere(M, req.query.q, req.query.status, req.query.category);

    if (String(req.query.export).toLowerCase() === 'csv') {
      const all = await M.findAll({ where, order });
      return sendCsv(res, all);
    }

    const { rows, count } = await M.findAndCountAll({ where, limit, offset, order });
    return res.json({ data: rows, pagination: { page, limit, total: count } });
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ error: err.expose ? err.message : 'Internal Server Error' });
  }
};

// GET /api/collateral/:id
exports.get = async (req, res) => {
  try {
    const M = getModel('Collateral');
    const row = await M.findByPk(req.params.id);
    if (!row) return res.status(404).json({ error: 'Not found' });
    res.json(row);
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ error: err.expose ? err.message : 'Internal Server Error' });
  }
};

// POST /api/collateral
exports.create = async (req, res) => {
  try {
    const M = getModel('Collateral');
    const payload = pick(M, req.body);
    const uid = actorId(req);
    if (uid && hasAttr(M, 'createdBy')) payload.createdBy = uid;
    if (uid && hasAttr(M, 'updatedBy')) payload.updatedBy = uid;

    const created = await M.create(payload);
    res.status(201).json(created);
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ error: err.expose ? err.message : 'Internal Server Error' });
  }
};

// PUT /api/collateral/:id
exports.update = async (req, res) => {
  try {
    const M = getModel('Collateral');
    const row = await M.findByPk(req.params.id);
    if (!row) return res.status(404).json({ error: 'Not found' });

    const payload = pick(M, req.body);
    const uid = actorId(req);
    if (uid && hasAttr(M, 'updatedBy')) payload.updatedBy = uid;

    await row.update(payload);
    res.json(row);
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ error: err.expose ? err.message : 'Internal Server Error' });
  }
};

// POST /api/collateral/:id/release
exports.release = async (req, res) => {
  try {
    // server-side auth check: only privileged roles
    const role = req.user?.role || req.headers['x-user-role'];
    const allowed = new Set(['admin', 'director', 'branch_manager']);
    if (!allowed.has(role)) return res.status(403).json({ error: 'Forbidden' });

    const M = getModel('Collateral');
    const row = await M.findByPk(req.params.id);
    if (!row) return res.status(404).json({ error: 'Not found' });

    await row.update({ status: 'RELEASED', updatedBy: actorId(req) || null });
    res.json({ ok: true, id: row.id, status: row.status });
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ error: err.expose ? err.message : 'Internal Server Error' });
  }
};

// DELETE /api/collateral/:id
exports.remove = async (req, res) => {
  try {
    const M = getModel('Collateral');
    const row = await M.findByPk(req.params.id);
    if (!row) return res.status(404).json({ error: 'Not found' });
    await row.destroy();
    res.json({ ok: true });
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ error: err.expose ? err.message : 'Internal Server Error' });
  }
};
