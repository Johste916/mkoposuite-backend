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

/** Helpers */
const hasAttr = (Model, attr) => Boolean(Model?.rawAttributes?.[attr]);

const toDate = (v) => {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

const startOfDay = (d) => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
};
const endOfDay = (d) => {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
};

const buildWhere = (Model, { q, status, type, dateFrom, dateTo, collector, loanOfficer, includeDeleted }) => {
  const where = {};

  // Exclude soft-deleted by default if deletedAt exists (fix logic)
  if (hasAttr(Model, 'deletedAt') && String(includeDeleted).toLowerCase() !== 'true') {
    where.deletedAt = null;
  }

  // Free-text search
  if (q) {
    const fields = ['type', 'collector', 'loanOfficer', 'status'].filter((f) => hasAttr(Model, f));
    if (fields.length) where[Op.or] = fields.map((f) => ({ [f]: { [Op.iLike]: `%${q}%` } }));
  }

  // Equality / contains filters
  if (status && hasAttr(Model, 'status')) where.status = status;
  if (type && hasAttr(Model, 'type')) where.type = type;
  if (collector && hasAttr(Model, 'collector')) where.collector = { [Op.iLike]: `%${collector}%` };
  if (loanOfficer && hasAttr(Model, 'loanOfficer')) where.loanOfficer = { [Op.iLike]: `%${loanOfficer}%` };

  // Date range
  const df = toDate(dateFrom);
  const dt = toDate(dateTo);
  if ((df || dt) && hasAttr(Model, 'date')) {
    where.date = {};
    if (df) where.date[Op.gte] = startOfDay(df);
    if (dt) where.date[Op.lte] = endOfDay(dt);
  }

  return where;
};

const applyScope = (Model, where, scope, extra = {}) => {
  if (!hasAttr(Model, 'date') || !hasAttr(Model, 'status')) return where;

  const today = startOfDay(new Date());
  const endToday = endOfDay(new Date());

  switch ((scope || '').toLowerCase()) {
    case 'daily':
      // date == today
      return { ...where, date: { [Op.gte]: today, [Op.lte]: endToday } };

    case 'missed':
      // scheduled before today and not completed
      return {
        ...where,
        date: { ...(where.date || {}), [Op.lt]: today },
        status: 'completed' === where.status ? where.status : { [Op.ne]: 'completed' },
      };

    case 'past-maturity':
    case 'past_maturity': {
      // older than N days (default 30) and not completed
      const n = Math.max(parseInt(extra.pastDays || '30', 10), 1);
      const threshold = startOfDay(new Date(Date.now() - n * 24 * 60 * 60 * 1000));
      return {
        ...where,
        date: { ...(where.date || {}), [Op.lt]: threshold },
        status: 'completed' === where.status ? where.status : { [Op.ne]: 'completed' },
      };
    }

    default:
      return where;
  }
};

const parseSort = (Model, sort) => {
  // sort format: field:dir (dir = ASC|DESC); multiple via comma
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
  const data = rows.map((r) => (r.toJSON ? r.toJSON() : r));
  const fields = Object.keys(data[0] || {});
  const parser = new CsvParser({ fields });
  const csv = parser.parse(data);
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="collection_sheets.csv"');
  res.status(200).send(csv);
};

/** Attempt to read actor user id for audit fields */
const getActorId = (req) => req.user?.id || req.headers['x-user-id'] || null;

// --- Controllers ---
exports.list = async (req, res) => {
  try {
    const Model = getModel('CollectionSheet');

    const page = Math.max(parseInt(req.query.page || '1', 10), 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit || '20', 10), 1), 200);
    const offset = (page - 1) * limit;

    const scope = req.query.scope;
    const baseWhere = buildWhere(Model, {
      q: req.query.q,
      status: req.query.status,
      type: req.query.type,
      collector: req.query.collector,
      loanOfficer: req.query.loanOfficer,
      dateFrom: req.query.dateFrom,
      dateTo: req.query.dateTo,
      includeDeleted: req.query.includeDeleted,
    });
    const where = applyScope(Model, baseWhere, scope, { pastDays: req.query.pastDays });
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

    // Soft delete if supported
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

// Small helper to expose scoped list via /daily, /missed, /past-maturity endpoints
exports.listWithScope = (scope) => (req, res) => {
  req.query.scope = scope;
  return exports.list(req, res);
};
