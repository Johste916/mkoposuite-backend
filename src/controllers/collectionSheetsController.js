// backend/src/controllers/collectionSheetsController.js
'use strict';

const { Op } = require('sequelize');
const { sequelize } = require('../models');
const { Parser: CsvParser } = require('json2csv');

/* ---------------- helpers ---------------- */

const getModel = (name) => {
  const m = sequelize?.models?.[name];
  if (!m) {
    const err = new Error(`Model "${name}" not found`);
    err.status = 500; err.expose = true;
    throw err;
  }
  return m;
};

const pick = (Model, body = {}) =>
  !Model?.rawAttributes
    ? body
    : Object.fromEntries(Object.entries(body).filter(([k]) => Model.rawAttributes[k]));

const hasAttr = (Model, attr) => Boolean(Model?.rawAttributes?.[attr]);

/** Normalize a user value to the model’s ENUM value (case-insensitive) */
const normalizeEnum = (Model, field, value) => {
  if (!value) return null;
  const attr = Model?.rawAttributes?.[field];
  const vals = Array.isArray(attr?.values) ? attr.values : null;
  if (!vals) return null;
  const lc = String(value).toLowerCase();
  return vals.find((v) => String(v).toLowerCase() === lc) || null;
};

/** WHERE builder (no ILIKE on ENUMs; keep DATEONLY as strings) */
const buildWhere = (Model, { q, status, type, dateFrom, dateTo, collector, loanOfficer }) => {
  const where = {};

  const normStatus = normalizeEnum(Model, 'status', status);
  if (normStatus) where.status = normStatus;

  // If type is ENUM on your model, normalize; else allow exact string
  const normType = normalizeEnum(Model, 'type', type) || (type && hasAttr(Model, 'type') ? type : null);
  if (normType) where.type = normType;

  if (collector && hasAttr(Model, 'collector')) where.collector = { [Op.iLike]: `%${collector}%` };
  if (loanOfficer && hasAttr(Model, 'loanOfficer')) where.loanOfficer = { [Op.iLike]: `%${loanOfficer}%` };

  if ((dateFrom || dateTo) && hasAttr(Model, 'date')) {
    where.date = {};
    if (dateFrom) where.date[Op.gte] = dateFrom; // keep as YYYY-MM-DD
    if (dateTo)   where.date[Op.lte] = dateTo;   // keep as YYYY-MM-DD
  }

  if (q) {
    const or = [];
    if (hasAttr(Model, 'type'))        or.push({ type:        { [Op.iLike]: `%${q}%` } });
    if (hasAttr(Model, 'collector'))   or.push({ collector:   { [Op.iLike]: `%${q}%` } });
    if (hasAttr(Model, 'loanOfficer')) or.push({ loanOfficer: { [Op.iLike]: `%${q}%` } });
    // do NOT include status here (ENUM)
    if (or.length) where[Op.or] = or;
  }

  return where;
};

const parseSort = (Model, sort) => {
  if (!sort) return [['date', 'DESC'], ['createdAt', 'DESC']];
  const out = [];
  for (const token of String(sort).split(',')) {
    const [field, dirRaw] = token.split(':');
    const dir = (dirRaw || 'ASC').toUpperCase() === 'DESC' ? 'DESC' : 'ASC';
    if (hasAttr(Model, field)) out.push([field, dir]);
  }
  return out.length ? out : [['date', 'DESC'], ['createdAt', 'DESC']];
};

const sendCsv = (res, rows) => {
  const plain = rows.map((r) => (r?.get ? r.get({ plain: true }) : r));
  const fields = ['date','type','collector','loanOfficer','status','branchId','id','createdAt','updatedAt']
    .filter((k) => k in (plain[0] || {}));
  const csv = new CsvParser({ fields }).parse(plain);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="collection_sheets.csv"');
  res.status(200).send(csv);
};

const getActorId = (req) => req.user?.id || req.headers['x-user-id'] || null;

/** Friendly error text for common Postgres errors (shown even in prod) */
const friendlyDbError = (err) => {
  const code = err?.original?.code;
  if (code === '42P01') return 'Database table "collection_sheets" is missing. Run migrations on this environment.';
  if (code === '42704') return 'A required enum/type is missing. Ensure the migration that creates the enum ran.';
  if (code === '23503') return 'Foreign key constraint failed (check branchId/collectorId/loanOfficerId).';
  if (code === '22P02') return 'Invalid input syntax (check query parameter types).';
  return null;
};

/* ---------------- controllers ---------------- */

exports.list = async (req, res) => {
  try {
    const Model = getModel('CollectionSheet');

    const page  = Math.max(parseInt(req.query.page || '1', 10), 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit || '20', 10), 1), 500);
    const offset = (page - 1) * limit;

    const where = buildWhere(Model, {
      q: req.query.q,
      status: req.query.status,
      type: req.query.type,
      collector: req.query.collector,
      loanOfficer: req.query.loanOfficer,
      dateFrom: req.query.dateFrom,
      dateTo: req.query.dateTo,
    });

    const order = parseSort(Model, req.query.sort);

    // Soft-deletes: use Sequelize paranoid instead of manually touching deletedAt
    const paranoid = String(req.query.includeDeleted).toLowerCase() === 'true' ? false : true;

    // CSV export (no pagination; capped)
    if (String(req.query.export).toLowerCase() === 'csv') {
      const rows = await Model.findAll({ where, order, paranoid, limit: 10000 });
      return sendCsv(res, rows);
    }

    const { rows, count } = await Model.findAndCountAll({ where, limit, offset, order, paranoid });
    return res.json({ data: rows, pagination: { page, limit, total: count } });
  } catch (err) {
    const friendly = friendlyDbError(err);
    if (process.env.NODE_ENV !== 'production') {
      console.error('CollectionSheets.list error:', err);
    }
    return res.status(err.status || 500).json({
      error: friendly || (err.expose ? err.message : 'Failed to fetch collection sheets'),
    });
  }
};

exports.get = async (req, res) => {
  try {
    const Model = getModel('CollectionSheet');
    const row = await Model.findByPk(req.params.id);
    if (!row) return res.status(404).json({ error: 'Not found' });
    res.json(row);
  } catch (err) {
    if (process.env.NODE_ENV !== 'production') console.error('CollectionSheets.get error:', err);
    res.status(err.status || 500).json({ error: err.expose ? err.message : 'Internal Server Error' });
  }
};

exports.create = async (req, res) => {
  try {
    const Model = getModel('CollectionSheet');
    const payload = pick(Model, req.body);

    // Normalize/validate enum
    if (hasAttr(Model, 'status') && payload.status) {
      const normalized = normalizeEnum(Model, 'status', payload.status);
      if (!normalized) return res.status(400).json({ error: 'Invalid status' });
      payload.status = normalized;
    }

    const actorId = getActorId(req);
    if (actorId && hasAttr(Model, 'createdBy')) payload.createdBy = actorId;
    if (actorId && hasAttr(Model, 'updatedBy')) payload.updatedBy = actorId;

    const created = await Model.create(payload);
    res.status(201).json(created);
  } catch (err) {
    if (process.env.NODE_ENV !== 'production') console.error('CollectionSheets.create error:', err);
    res.status(err.status || 500).json({ error: err.expose ? err.message : 'Internal Server Error' });
  }
};

exports.update = async (req, res) => {
  try {
    const Model = getModel('CollectionSheet');
    const row = await Model.findByPk(req.params.id);
    if (!row) return res.status(404).json({ error: 'Not found' });

    const payload = pick(Model, req.body);

    if (hasAttr(Model, 'status') && payload.status) {
      const normalized = normalizeEnum(Model, 'status', payload.status);
      if (!normalized) return res.status(400).json({ error: 'Invalid status' });
      payload.status = normalized;
    }

    const actorId = getActorId(req);
    if (actorId && hasAttr(Model, 'updatedBy')) payload.updatedBy = actorId;

    await row.update(payload);
    res.json(row);
  } catch (err) {
    if (process.env.NODE_ENV !== 'production') console.error('CollectionSheets.update error:', err);
    res.status(err.status || 500).json({ error: err.expose ? err.message : 'Internal Server Error' });
  }
};

exports.remove = async (req, res) => {
  try {
    const Model = getModel('CollectionSheet');
    const row = await Model.findByPk(req.params.id);
    if (!row) return res.status(404).json({ error: 'Not found' });
    await row.destroy(); // soft or hard depending on Model.options.paranoid
    res.json({ ok: true, softDeleted: Boolean(Model.options?.paranoid) });
  } catch (err) {
    if (process.env.NODE_ENV !== 'production') console.error('CollectionSheets.remove error:', err);
    res.status(err.status || 500).json({ error: err.expose ? err.message : 'Internal Server Error' });
  }
};

exports.restore = async (req, res) => {
  try {
    const Model = getModel('CollectionSheet');
    if (!Model.options?.paranoid) return res.status(400).json({ error: 'Restore not supported' });

    const row = await Model.findByPk(req.params.id, { paranoid: false });
    if (!row) return res.status(404).json({ error: 'Not found' });

    await row.restore();

    const actorId = getActorId(req);
    if (actorId && hasAttr(Model, 'updatedBy')) await row.update({ updatedBy: actorId });

    res.json({ ok: true, restored: true });
  } catch (err) {
    if (process.env.NODE_ENV !== 'production') console.error('CollectionSheets.restore error:', err);
    res.status(err.status || 500).json({ error: err.expose ? err.message : 'Internal Server Error' });
  }
};
