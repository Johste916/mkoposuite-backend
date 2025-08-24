'use strict';
const { Op } = require('sequelize');
const { sequelize } = require('../models');
const { Parser: CsvParser } = require('json2csv');

const getModel = (name) => {
  const m = sequelize?.models?.[name];
  if (!m) throw Object.assign(new Error(`Model "${name}" not found`), { status: 500, expose: true });
  return m;
};
const hasAttr = (Model, attr) => Boolean(Model?.rawAttributes?.[attr]);
const pick = (Model, body = {}) =>
  !Model?.rawAttributes ? body : Object.fromEntries(Object.entries(body).filter(([k]) => Model.rawAttributes[k]));
const actorId = (req) => req.user?.id || req.headers['x-user-id'] || null;

const parseDate = (v) => { if (!v) return null; const d = new Date(v); return isNaN(d.getTime()) ? null : d; };

const buildWhere = (Model, { q, status, category, dateFrom, dateTo }) => {
  const where = {};
  if (q) {
    const fields = ['itemName', 'category', 'model', 'serialNumber', 'location', 'notes']
      .filter((f) => hasAttr(Model, f));
    if (fields.length) where[Op.or] = fields.map((f) => ({ [f]: { [Op.iLike]: `%${q}%` } }));
  }
  if (status && hasAttr(Model, 'status')) where.status = status;
  if (category && hasAttr(Model, 'category')) where.category = { [Op.iLike]: `%${category}%` };

  const df = parseDate(dateFrom);
  const dt = parseDate(dateTo);
  if (df || dt) {
    const col = hasAttr(Model, 'createdAt') ? 'createdAt' : (hasAttr(Model, 'date') ? 'date' : null);
    if (col) {
      where[col] = {};
      if (df) where[col][Op.gte] = df;
      if (dt) { const end = new Date(dt); end.setHours(23, 59, 59, 999); where[col][Op.lte] = end; }
    }
  }
  return where;
};

const parseSort = (Model, sort) => {
  if (!sort) return [['createdAt', 'DESC']];
  const parts = String(sort).split(',');
  const result = [];
  for (const p of parts) {
    const [field, dirRaw] = p.split(':');
    if (hasAttr(Model, field)) result.push([field, (dirRaw || 'ASC').toUpperCase() === 'DESC' ? 'DESC' : 'ASC']);
  }
  return result.length ? result : [['createdAt', 'DESC']];
};

const sendCsv = (res, rows) => {
  const fields = Object.keys(rows[0] ? (rows[0].toJSON ? rows[0].toJSON() : rows[0]) : { id: 1 });
  const parser = new CsvParser({ fields });
  const data = rows.map((r) => (r.toJSON ? r.toJSON() : r));
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="collaterals.csv"');
  res.status(200).send(parser.parse(data));
};

// ------------ CRUD -------------
exports.list = async (req, res) => {
  try {
    const Model = getModel('Collateral');

    const page = Math.max(parseInt(req.query.page || '1', 10), 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit || '20', 10), 1), 200);
    const offset = (page - 1) * limit;

    const where = buildWhere(Model, {
      q: req.query.q,
      status: req.query.status,
      category: req.query.category,
      dateFrom: req.query.dateFrom,
      dateTo: req.query.dateTo,
    });
    const order = parseSort(Model, req.query.sort);

    if (String(req.query.export).toLowerCase() === 'csv') {
      const all = await Model.findAll({ where, order });
      return sendCsv(res, all);
    }

    const { rows, count } = await Model.findAndCountAll({ where, limit, offset, order });
    return res.json({ data: rows, pagination: { page, limit, total: count } });
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ error: err.expose ? err.message : 'Internal Server Error' });
  }
};

exports.get = async (req, res) => {
  try {
    const Model = getModel('Collateral');
    const row = await Model.findByPk(req.params.id);
    if (!row) return res.status(404).json({ error: 'Not found' });
    res.json(row);
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ error: err.expose ? err.message : 'Internal Server Error' });
  }
};

exports.create = async (req, res) => {
  try {
    const Model = getModel('Collateral');
    const Loan = sequelize.models?.Loan;
    const payload = pick(Model, req.body);

    if (!payload.itemName) return res.status(400).json({ error: 'itemName is required' });
    if (!payload.borrowerId) return res.status(400).json({ error: 'borrowerId is required' });

    if (!payload.loanId && Loan && Loan.rawAttributes?.status && req.body.autoDetectLoan !== false) {
      const CLOSED = ['closed','completed','paid','paid_off','repaid','settled','cancelled','written_off','defaulted','reversed'];
      const list = await Loan.findAll({
        where: { borrowerId: payload.borrowerId, status: { [Op.notIn]: CLOSED } },
        limit: 2, order: [['createdAt','DESC']], attributes: ['id','status'],
      });
      if (list.length === 1) {
        payload.loanId = list[0].id;
      } else if (list.length > 1) {
        return res.status(400).json({ error: 'Borrower has multiple open loans. Please choose loanId.' });
      }
    }

    const uid = actorId(req);
    if (uid && hasAttr(Model,'createdBy')) payload.createdBy = uid;
    if (uid && hasAttr(Model,'updatedBy')) payload.updatedBy = uid;

    const created = await Model.create(payload);
    res.status(201).json(created);
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ error: err.expose ? err.message : 'Internal Server Error' });
  }
};

exports.update = async (req, res) => {
  try {
    const Model = getModel('Collateral');
    const row = await Model.findByPk(req.params.id);
    if (!row) return res.status(404).json({ error: 'Not found' });

    const payload = pick(Model, req.body);
    const uid = actorId(req);
    if (uid && hasAttr(Model,'updatedBy')) payload.updatedBy = uid;

    await row.update(payload);
    res.json(row);
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ error: err.expose ? err.message : 'Internal Server Error' });
  }
};

/** optional delete to avoid "undefined" callbacks in routes */
exports.remove = async (req, res) => {
  try {
    const Model = getModel('Collateral');
    const row = await Model.findByPk(req.params.id);
    if (!row) return res.status(404).json({ error: 'Not found' });
    await row.destroy();
    res.json({ ok: true });
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ error: err.expose ? err.message : 'Internal Server Error' });
  }
};

exports.release = async (req, res) => {
  try {
    const Model = getModel('Collateral');
    const row = await Model.findByPk(req.params.id);
    if (!row) return res.status(404).json({ error: 'Not found' });

    const patch = { status: 'RELEASED' };
    const uid = actorId(req);
    if (uid && hasAttr(Model,'updatedBy')) patch.updatedBy = uid;

    await row.update(patch);
    res.json({ ok: true, id: row.id, status: row.status });
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ error: err.expose ? err.message : 'Internal Server Error' });
  }
};

// -------- Helpers for the form ----------
exports.searchBorrowers = async (req, res) => {
  try {
    const Borrower = getModel('Borrower');
    const q = String(req.query.q || '').trim();
    if (!q) return res.json({ data: [] });

    const where = {
      [Op.or]: [
        { name:  { [Op.iLike]: `%${q}%` } },
        { phone: { [Op.iLike]: `%${q}%` } },
        { code:  { [Op.iLike]: `%${q}%` } },
      ],
    };
    const rows = await Borrower.findAll({ where, limit: 10, order: [['name','ASC']], attributes: ['id','name','phone'] });
    res.json({ data: rows });
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ error: err.expose ? err.message : 'Internal Server Error' });
  }
};

exports.getOpenLoans = async (req, res) => {
  try {
    const Loan = getModel('Loan');
    const borrowerId = req.query.borrowerId;
    if (!borrowerId) return res.status(400).json({ error: 'borrowerId is required' });

    const CLOSED = ['closed','completed','paid','paid_off','repaid','settled','cancelled','written_off','defaulted','reversed'];
    const where = { borrowerId };
    if (Loan.rawAttributes?.status) where.status = { [Op.notIn]: CLOSED };

    const rows = await Loan.findAll({
      where, attributes: ['id','principal','status','createdAt'],
      order: [['createdAt','DESC']], limit: 50,
    });
    res.json({ data: rows });
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ error: err.expose ? err.message : 'Internal Server Error' });
  }
};
