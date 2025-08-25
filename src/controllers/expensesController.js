'use strict';

const { Op } = require('sequelize');
const { sequelize } = require('../models');
const { resolveTenantId } = require('../lib/tenant');

// CSV helpers (install: npm i csv-parse csv-stringify)
let parseSync, stringifySync;
try {
  ({ parse: parseSync } = require('csv-parse/sync'));
  ({ stringify: stringifySync } = require('csv-stringify/sync'));
} catch (e) {
  // optional; we'll throw a friendly error if CSV endpoints are hit without deps
}

const getModel = (n) => {
  const m = sequelize?.models?.[n];
  if (!m) throw Object.assign(new Error(`Model "${n}" not found`), { status: 500, expose: true });
  return m;
};

const pick = (m, b = {}) =>
  !m.rawAttributes ? b : Object.fromEntries(Object.entries(b).filter(([k]) => m.rawAttributes[k]));

const searchWhere = (m, q) => {
  if (!q) return {};
  const fields = ['type', 'note', 'vendor', 'reference'].filter(f => m.rawAttributes?.[f]);
  return fields.length ? { [Op.or]: fields.map(f => ({ [f]: { [Op.iLike]: `%${q}%` } })) } : {};
};

const filtersFromQuery = (Expense, q = {}) => {
  const where = { ...searchWhere(Expense, q.q) };

  // type exact
  if (q.type) where.type = String(q.type).toUpperCase();

  // vendor contains
  if (q.vendor) where.vendor = { [Op.iLike]: `%${q.vendor}%` };

  // date range
  if (q.date_from || q.date_to) where.date = {};
  if (q.date_from) where.date[Op.gte] = q.date_from;
  if (q.date_to)   where.date[Op.lte] = q.date_to;

  // amount range
  if (q.min_amount) where.amount = { ...(where.amount || {}), [Op.gte]: q.min_amount };
  if (q.max_amount) where.amount = { ...(where.amount || {}), [Op.lte]: q.max_amount };

  // branch
  if (q.branch_id) where.branchId = q.branch_id;

  return where;
};

exports.list = async (req, res) => {
  try {
    const Expense = getModel('Expense');
    const tenantId = resolveTenantId(req); // optional fallback

    const page  = Math.max(parseInt(req.query.page || '1', 10), 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit || '20', 10), 1), 200);
    const offset = (page - 1) * limit;

    const where = {
      ...(tenantId ? { tenantId } : {}),
      ...filtersFromQuery(Expense, req.query),
    };

    // sort
    const sort = (req.query.sort || 'date').toString();
    const dir  = (req.query.dir || 'DESC').toString().toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
    const order = [['date', 'DESC'], ['createdAt', 'DESC']];
    if (sort && Expense.rawAttributes[sort]) {
      order.unshift([sort, dir]);
    }

    const { rows, count } = await Expense.findAndCountAll({
      where, limit, offset, order,
    });

    res.json({ data: rows, pagination: { page, limit, total: count } });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.expose ? err.message : 'Internal Server Error' });
  }
};

exports.get = async (req, res) => {
  try {
    const Expense = getModel('Expense');
    const tenantId = resolveTenantId(req);
    const row = await Expense.findOne({
      where: { id: req.params.id, ...(tenantId ? { tenantId } : {}) }
    });
    if (!row) return res.status(404).json({ error: 'Not found' });
    res.json(row);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.expose ? err.message : 'Internal Server Error' });
  }
};

exports.create = async (req, res) => {
  try {
    const Expense = getModel('Expense');
    const tenantId = resolveTenantId(req, { requireForWrite: true });
    const payload = pick(Expense, req.body);
    payload.tenantId = tenantId;
    if (!payload.date) payload.date = new Date();
    const created = await Expense.create(payload);
    res.status(201).json(created);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.expose ? err.message : 'Internal Server Error' });
  }
};

exports.update = async (req, res) => {
  try {
    const Expense = getModel('Expense');
    const tenantId = resolveTenantId(req, { requireForWrite: true });
    const row = await Expense.findOne({ where: { id: req.params.id, tenantId } });
    if (!row) return res.status(404).json({ error: 'Not found' });
    await row.update(pick(Expense, req.body));
    res.json(row);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.expose ? err.message : 'Internal Server Error' });
  }
};

exports.remove = async (req, res) => {
  try {
    const Expense = getModel('Expense');
    const tenantId = resolveTenantId(req, { requireForWrite: true });
    const row = await Expense.findOne({ where: { id: req.params.id, tenantId } });
    if (!row) return res.status(404).json({ error: 'Not found' });
    await row.destroy();
    res.json({ ok: true });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.expose ? err.message : 'Internal Server Error' });
  }
};

/* ---------------------------- CSV: Upload & Export ---------------------------- */

exports.uploadCsv = async (req, res) => {
  try {
    if (!parseSync) {
      throw Object.assign(new Error('CSV dependencies not installed. Run: npm i csv-parse csv-stringify'), { status: 500, expose: true });
    }
    if (!req.file?.buffer?.length) {
      throw Object.assign(new Error('No file uploaded'), { status: 400, expose: true });
    }

    const Expense = getModel('Expense');
    const tenantId = resolveTenantId(req, { requireForWrite: true });

    const text = req.file.buffer.toString('utf8');
    const rows = parseSync(text, { columns: true, skip_empty_lines: true, trim: true });

    const prepared = [];
    const errors = [];

    for (let i = 0; i < rows.length; i += 1) {
      const r = rows[i];

      const rec = {
        tenantId,
        date: r.date || r.Date || r.transaction_date || null,
        type: (r.type || r.Type || '').toString().toUpperCase(),
        vendor: r.vendor || r.Vendor || null,
        reference: r.reference || r.Reference || r.ref || null,
        amount: r.amount || r.Amount || r.total || null,
        note: r.note || r.Note || r.description || null,
        branchId: r.branch_id || r.branchId || null,
      };

      // Basic validation
      if (!rec.date || !rec.type || !rec.amount) {
        errors.push({ index: i + 1, error: 'Missing required fields (date/type/amount)', raw: r });
        continue;
      }

      prepared.push(pick(Expense, rec));
    }

    let created = [];
    if (prepared.length) {
      created = await Expense.bulkCreate(prepared, { validate: true });
    }

    res.json({ inserted: created.length, failed: errors.length, errors });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.expose ? err.message : 'Internal Server Error' });
  }
};

exports.exportCsv = async (req, res) => {
  try {
    if (!stringifySync) {
      throw Object.assign(new Error('CSV dependencies not installed. Run: npm i csv-parse csv-stringify'), { status: 500, expose: true });
    }
    const Expense = getModel('Expense');
    const tenantId = resolveTenantId(req);

    const where = {
      ...(tenantId ? { tenantId } : {}),
      ...filtersFromQuery(Expense, req.query),
    };

    const order = [['date', 'DESC'], ['createdAt', 'DESC']];
    const rows = await Expense.findAll({ where, order });

    const data = rows.map((r) => ({
      id: r.id,
      date: r.date,
      type: r.type,
      vendor: r.vendor,
      reference: r.reference,
      amount: r.amount,
      note: r.note,
      branch_id: r.branchId,
    }));

    const csv = stringifySync(data, { header: true });
    const fname = `expenses_${new Date().toISOString().slice(0, 10)}.csv`;

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${fname}"`);
    res.send(csv);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.expose ? err.message : 'Internal Server Error' });
  }
};
