'use strict';
const { Op } = require('sequelize');
const { sequelize } = require('../models');
const { Parser: CsvParser } = require('json2csv');

/** Pull model safely */
const getModel = (n) => {
  const m = sequelize?.models?.[n];
  if (!m) throw Object.assign(new Error(`Model "${n}" not found`), { status: 500, expose: true });
  return m;
};

/** Whitelist only known columns for safety */
const pick = (model, body) =>
  !model.rawAttributes
    ? body
    : Object.fromEntries(Object.entries(body || {}).filter(([k]) => model.rawAttributes[k]));

/** Helpers to check optional columns */
const hasAttr = (Model, attr) => Boolean(Model.rawAttributes?.[attr]);

const toDate = (v) => {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
};

const buildWhere = (Model, { q, status, type, dateFrom, dateTo, collector, loanOfficer, includeDeleted }) => {
  const where = {};

  // Exclude soft-deleted by default if deletedAt exists
  if (hasAttr(Model, 'deletedAt') && !String(includeDeleted).toLowerCase() === 'true') {
    where.deletedAt = null;
  }

  // Free-text search
  if (q) {
    const fields = ['type', 'collector', 'loanOfficer', 'status'].filter((f) => hasAttr(Model, f));
    if (fields.length) where[Op.or] = fields.map((f) => ({ [f]: { [Op.iLike]: `%${q}%` } }));
  }

  // Equality filters (case-insensitive for names)
  if (status && hasAttr(Model, 'status')) where.status = status;
  if (type && hasAttr(Model, 'type')) where.type = type;
  if (collector && hasAttr(Model, 'collector')) where.collector = { [Op.iLike]: collector };
  if (loanOfficer && hasAttr(Model, 'loanOfficer')) where.loanOfficer = { [Op.iLike]: loanOfficer };

  // Date range
  const df = toDate(dateFrom);
  const dt = toDate(dateTo);
  if ((df || dt) && hasAttr(Model, 'date')) {
    where.date = {};
    if (df) where.date[Op.gte] = df;
    if (dt) {
      const end = new Date(dt);
      end.setHours(23, 59, 59, 999); // include end of day
      where.date[Op.lte] = end;
    }
  }

  return where;
};

const parseSort = (Model, sort) => {
  // sort format: field:dir (dir = ASC|DESC); multiple allowed via comma
  if (!sort) return [['date', 'DESC']];
  const parts = String(sort).split(',');
  const entries = [];
  for (const p of parts) {
    const [field, dirRaw] = p.split(':');
    const dir = (dirRaw || 'ASC').toUpperCase() === 'DESC' ? 'DESC' : 'ASC';
    if (hasAttr(Model, field)) entries.push([field, dir]);
  }
  return entries.length ? entries : [['date', 'DESC']];
};

const sendCsv = (res, rows) => {
  const fields = Object.keys(rows[0] || {});
  const parser = new CsvParser({ fields });
  const csv = parser.parse(rows.map((r) => (r.toJSON ? r.toJSON() : r)));
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="collection_sheets.csv"');
  res.status(200).send(csv);
};

/** Attempt to read actor user id for audit fields */
const getActorId = (req) => {
  // Works with your auth if it sets req.user; fallback to header
  return req.user?.id || req.headers['x-user-id'] || null;
};

// --- Controllers ---
exports.list = async (req, res) => {
  try {
    const Model = getModel('CollectionSheet');

    const page = Math.max(parseInt(req.query.page || '1', 10), 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit || '20', 10), 1), 200);
    const offset = (page - 1) * limit;

    const where = buildWhere(Model, {
      q: req.query.q,
      status: req.query.status,
      type: req.query.type,
      collector: req.query.collector,
      loanOfficer: req.query.loanOfficer,
      dateFrom: req.query.dateFrom,
      dateTo: req.query.dateTo,
      includeDeleted: req.query.includeDeleted,
    });

    const order = parseSort(Model, req.query.sort);

    // CSV export (no pagination)
    if (String(req.query.export).toLowerCase() === 'csv') {
      const rows = await Model.findAll({ where, order, raw: false });
      return sendCsv(res, rows);
    }

    const { rows, count } = await Model.findAndCountAll({ where, limit, offset, order });
    return res.json({ data: rows, pagination: { page, limit, total: count } });
  } catch (err) {
    const status = err.status || 500;
    return res.status(status).json({ error: err.expose ? err.message : 'Internal Server Error' });
  }
};

exports.get = async (req, res) => {
  try {
    const Model = getModel('CollectionSheet');
    const row = await Model.findByPk(req.params.id);
    if (!row) return res.status(404).json({ error: 'Not found' });
    return res.json(row);
  } catch (err) {
    const status = err.status || 500;
    return res.status(status).json({ error: err.expose ? err.message : 'Internal Server Error' });
  }
};

exports.create = async (req, res) => {
  try {
    const Model = getModel('CollectionSheet');
    const payload = pick(Model, req.body);

    if (payload.date) payload.date = toDate(payload.date);

    const actorId = getActorId(req);
    if (actorId && hasAttr(Model, 'createdBy')) payload.createdBy = actorId;
    if (actorId && hasAttr(Model, 'updatedBy')) payload.updatedBy = actorId;

    const created = await Model.create(payload);
    return res.status(201).json(created);
  } catch (err) {
    const status = err.status || 500;
    return res.status(status).json({ error: err.expose ? err.message : 'Internal Server Error' });
  }
};

exports.update = async (req, res) => {
  try {
    const Model = getModel('CollectionSheet');
    const row = await Model.findByPk(req.params.id);
    if (!row) return res.status(404).json({ error: 'Not found' });

    const payload = pick(Model, req.body);
    if (payload.date) payload.date = toDate(payload.date);

    const actorId = getActorId(req);
    if (actorId && hasAttr(Model, 'updatedBy')) payload.updatedBy = actorId;

    await row.update(payload);
    return res.json(row);
  } catch (err) {
    const status = err.status || 500;
    return res.status(status).json({ error: err.expose ? err.message : 'Internal Server Error' });
  }
};

exports.remove = async (req, res) => {
  try {
    const Model = getModel('CollectionSheet');
    const row = await Model.findByPk(req.params.id);
    if (!row) return res.status(404).json({ error: 'Not found' });

    // Soft delete if deletedAt is supported; otherwise hard delete
    if (hasAttr(Model, 'deletedAt')) {
      const actorId = getActorId(req);
      const patch = { deletedAt: new Date() };
      if (actorId && hasAttr(Model, 'updatedBy')) patch.updatedBy = actorId;
      await row.update(patch);
      return res.json({ ok: true, softDeleted: true });
    }

    await row.destroy();
    return res.json({ ok: true, softDeleted: false });
  } catch (err) {
    const status = err.status || 500;
    return res.status(status).json({ error: err.expose ? err.message : 'Internal Server Error' });
  }
};

exports.restore = async (req, res) => {
  try {
    const Model = getModel('CollectionSheet');
    if (!hasAttr(Model, 'deletedAt')) {
      return res.status(400).json({ error: 'Restore not supported (no deletedAt column).' });
    }
    const row = await Model.findByPk(req.params.id);
    if (!row) return res.status(404).json({ error: 'Not found' });

    const actorId = getActorId(req);
    const patch = { deletedAt: null };
    if (actorId && hasAttr(Model, 'updatedBy')) patch.updatedBy = actorId;

    await row.update(patch);
    return res.json({ ok: true, restored: true });
  } catch (err) {
    const status = err.status || 500;
    return res.status(status).json({ error: err.expose ? err.message : 'Internal Server Error' });
  }
};
