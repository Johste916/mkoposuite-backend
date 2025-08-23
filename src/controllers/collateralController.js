'use strict';

const { Op } = require('sequelize');
const { sequelize } = require('../models');
const { Parser: CsvParser } = require('json2csv');

const getModel = (name) => {
  const m = sequelize?.models?.[name];
  if (!m) {
    const err = new Error(`Model "${name}" not found`);
    err.status = 500; err.expose = true;
    throw err;
  }
  return m;
};
const hasAttr = (M, a) => Boolean(M?.rawAttributes?.[a]);
const pick = (M, body) =>
  !M?.rawAttributes ? body :
  Object.fromEntries(Object.entries(body || {}).filter(([k]) => M.rawAttributes[k]));

const toDate = (v) => {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

const buildWhere = (M, { q, status, category, borrowerId, loanId, dateFrom, dateTo, includeDeleted }) => {
  const where = {};
  // support paranoid later if you add deletedAt; currently table is not paranoid
  if (q) {
    const fields = ['itemName', 'category', 'model', 'serialNumber', 'status', 'location', 'notes']
      .filter((f) => hasAttr(M, f));
    if (fields.length) where[Op.or] = fields.map((f) => ({ [f]: { [Op.iLike]: `%${q}%` } }));
  }
  if (status && hasAttr(M, 'status')) where.status = status;
  if (category && hasAttr(M, 'category')) where.category = category;
  if (borrowerId && hasAttr(M, 'borrowerId')) where.borrowerId = borrowerId;
  if (loanId && hasAttr(M, 'loanId')) where.loanId = loanId;

  // Filter by createdAt range (or change to another column if you prefer)
  const df = toDate(dateFrom);
  const dt = toDate(dateTo);
  if ((df || dt) && hasAttr(M, 'createdAt')) {
    where.createdAt = {};
    if (df) where.createdAt[Op.gte] = df;
    if (dt) {
      const end = new Date(dt);
      end.setHours(23,59,59,999);
      where.createdAt[Op.lte] = end;
    }
  }
  return where;
};

const parseSort = (M, sort) => {
  if (!sort) return [['createdAt', 'DESC']];
  const parts = String(sort).split(',');
  const out = [];
  for (const p of parts) {
    const [field, dirRaw] = p.split(':');
    const dir = (dirRaw || 'ASC').toUpperCase() === 'DESC' ? 'DESC' : 'ASC';
    if (hasAttr(M, field)) out.push([field, dir]);
  }
  return out.length ? out : [['createdAt', 'DESC']];
};

const sendCsv = (res, rows) => {
  const plain = rows.map((r) => (r?.toJSON ? r.toJSON() : r));
  const fields = Object.keys(plain[0] || {});
  const csv = new CsvParser({ fields }).parse(plain);
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="collateral.csv"');
  res.status(200).send(csv);
};

// Map common PG errors to friendly messages
const friendlyDbError = (err) => {
  const code = err?.original?.code || err?.parent?.code;
  if (code === '42P01') return 'Database table "collaterals" is missing. Run the migration for collaterals.';
  if (code === '42703') return 'A referenced column does not exist on "collaterals". Check your migration vs model.';
  return null;
};

// --------- Actions ----------
exports.list = async (req, res) => {
  try {
    const M = getModel('Collateral');
    const page  = Math.max(parseInt(req.query.page  || '1', 10), 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit || '20', 10), 1), 200);
    const offset = (page - 1) * limit;

    const where = buildWhere(M, {
      q: req.query.q,
      status: req.query.status,
      category: req.query.category,
      borrowerId: req.query.borrowerId,
      loanId: req.query.loanId,
      dateFrom: req.query.dateFrom,
      dateTo: req.query.dateTo,
    });
    const order = parseSort(M, req.query.sort);

    if (String(req.query.export).toLowerCase() === 'csv') {
      const rows = await M.findAll({ where, order });
      return sendCsv(res, rows);
    }

    const { rows, count } = await M.findAndCountAll({ where, order, limit, offset });
    return res.json({ data: rows, pagination: { page, limit, total: count } });
  } catch (err) {
    const friendly = friendlyDbError(err);
    const status = err.status || 500;
    return res.status(status).json({ error: friendly || (err.expose ? err.message : 'Internal Server Error') });
  }
};

exports.get = async (req, res) => {
  try {
    const M = getModel('Collateral');
    const row = await M.findByPk(req.params.id);
    if (!row) return res.status(404).json({ error: 'Not found' });
    return res.json(row);
  } catch (err) {
    const friendly = friendlyDbError(err);
    const status = err.status || 500;
    return res.status(status).json({ error: friendly || (err.expose ? err.message : 'Internal Server Error') });
  }
};

exports.create = async (req, res) => {
  try {
    const M = getModel('Collateral');
    const payload = pick(M, req.body);
    const created = await M.create(payload);
    return res.status(201).json(created);
  } catch (err) {
    const friendly = friendlyDbError(err);
    const status = err.status || 500;
    return res.status(status).json({ error: friendly || (err.expose ? err.message : 'Internal Server Error') });
  }
};

exports.update = async (req, res) => {
  try {
    const M = getModel('Collateral');
    const row = await M.findByPk(req.params.id);
    if (!row) return res.status(404).json({ error: 'Not found' });

    const payload = pick(M, req.body);
    await row.update(payload);
    return res.json(row);
  } catch (err) {
    const friendly = friendlyDbError(err);
    const status = err.status || 500;
    return res.status(status).json({ error: friendly || (err.expose ? err.message : 'Internal Server Error') });
  }
};

exports.remove = async (req, res) => {
  try {
    const M = getModel('Collateral');
    const row = await M.findByPk(req.params.id);
    if (!row) return res.status(404).json({ error: 'Not found' });
    await row.destroy();
    return res.json({ ok: true });
  } catch (err) {
    const friendly = friendlyDbError(err);
    const status = err.status || 500;
    return res.status(status).json({ error: friendly || (err.expose ? err.message : 'Internal Server Error') });
  }
};
