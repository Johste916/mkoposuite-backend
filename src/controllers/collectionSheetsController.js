// backend/src/controllers/collectionSheetsController.js
'use strict';

const { Op } = require('sequelize');
const { sequelize } = require('../models');
const { Parser: CsvParser } = require('json2csv');

/** Safe model getter */
const getModel = (name) => {
  const m = sequelize?.models?.[name];
  if (!m) {
    const err = new Error(`Model "${name}" not found`);
    err.status = 500; err.expose = true;
    throw err;
  }
  return m;
};

/** Whitelist only attributes that exist on the model */
const pick = (Model, body = {}) =>
  !Model?.rawAttributes
    ? body
    : Object.fromEntries(Object.entries(body).filter(([k]) => Model.rawAttributes[k]));

/** Helper */
const hasAttr = (Model, attr) => Boolean(Model?.rawAttributes?.[attr]);

/** Build WHERE safely (no ILIKE on ENUM) */
const buildWhere = (Model, {
  q,
  status,
  type,
  dateFrom,
  dateTo,
  collector,
  loanOfficer,
}) => {
  const where = {};

  // Exact match for ENUM
  if (status && hasAttr(Model, 'status')) where.status = status;

  // Exact match for type (string)
  if (type && hasAttr(Model, 'type')) where.type = type;

  // Fuzzy fields (strings only)
  if (collector && hasAttr(Model, 'collector')) {
    where.collector = { [Op.iLike]: `%${collector}%` };
  }
  if (loanOfficer && hasAttr(Model, 'loanOfficer')) {
    where.loanOfficer = { [Op.iLike]: `%${loanOfficer}%` };
  }

  // Date range (DATEONLY: keep as YYYY-MM-DD strings to avoid TZ surprises)
  if ((dateFrom || dateTo) && hasAttr(Model, 'date')) {
    where.date = {};
    if (dateFrom) where.date[Op.gte] = dateFrom;
    if (dateTo)   where.date[Op.lte] = dateTo;
  }

  // Global q across STRING columns (exclude ENUM 'status')
  if (q) {
    const or = [];
    if (hasAttr(Model, 'type'))        or.push({ type:        { [Op.iLike]: `%${q}%` } });
    if (hasAttr(Model, 'collector'))   or.push({ collector:   { [Op.iLike]: `%${q}%` } });
    if (hasAttr(Model, 'loanOfficer')) or.push({ loanOfficer: { [Op.iLike]: `%${q}%` } });
    if (or.length) where[Op.or] = or;
  }

  return where;
};

const parseSort = (Model, sort) => {
  // format: field:dir,field2:dir2 (dir = ASC|DESC)
  if (!sort) return [['date', 'DESC'], ['createdAt', 'DESC']];
  const parts = String(sort).split(',');
  const out = [];
  for (const p of parts) {
    const [field, dirRaw] = p.split(':');
    const dir = (dirRaw || 'ASC').toUpperCase() === 'DESC' ? 'DESC' : 'ASC';
    if (hasAttr(Model, field)) out.push([field, dir]);
  }
  return out.length ? out : [['date', 'DESC'], ['createdAt', 'DESC']];
};

const sendCsv = (res, rows) => {
  const plain = rows.map((r) => (r?.get ? r.get({ plain: true }) : r));
  const fields = Object.keys(plain[0] || {});
  const parser = new CsvParser({ fields });
  const csv = parser.parse(plain);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="collection_sheets.csv"');
  res.status(200).send(csv);
};

/** Actor (for createdBy/updatedBy) */
const getActorId = (req) => req.user?.id || req.headers['x-user-id'] || null;

/** Valid ENUM values (keep in sync with model/migration) */
const VALID_STATUS = new Set(['PENDING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']);

// -------------------------- Controllers --------------------------

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

    // Include soft-deleted rows?
    const paranoid = String(req.query.includeDeleted).toLowerCase() === 'true' ? false : true;

    // CSV export (no pagination)
    if (String(req.query.export).toLowerCase() === 'csv') {
      const rows = await Model.findAll({ where, order, paranoid, limit: 10000 });
      return sendCsv(res, rows);
    }

    const { rows, count } = await Model.findAndCountAll({ where, limit, offset, order, paranoid });
    return res.json({ data: rows, pagination: { page, limit, total: count } });
  } catch (err) {
    const status = err.status || 500;
    return res.status(status).json({ error: err.expose ? err.message : 'Failed to fetch collection sheets' });
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

    // Validate ENUM status early (avoid DB error)
    if (payload.status && !VALID_STATUS.has(payload.status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

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

    if (payload.status && !VALID_STATUS.has(payload.status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

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

    // Use Sequelize behavior: soft-delete if paranoid, hard-delete otherwise
    await row.destroy();
    return res.json({ ok: true, softDeleted: Boolean(Model.options?.paranoid) });
  } catch (err) {
    const status = err.status || 500;
    return res.status(status).json({ error: err.expose ? err.message : 'Internal Server Error' });
  }
};

exports.restore = async (req, res) => {
  try {
    const Model = getModel('CollectionSheet');

    if (!Model.options?.paranoid) {
      return res.status(400).json({ error: 'Restore not supported (model is not paranoid).' });
    }

    // Must disable paranoid to find soft-deleted rows
    const row = await Model.findByPk(req.params.id, { paranoid: false });
    if (!row) return res.status(404).json({ error: 'Not found' });

    await row.restore();

    const actorId = getActorId(req);
    if (actorId && hasAttr(Model, 'updatedBy')) {
      await row.update({ updatedBy: actorId });
    }

    return res.json({ ok: true, restored: true });
  } catch (err) {
    const status = err.status || 500;
    return res.status(status).json({ error: err.expose ? err.message : 'Internal Server Error' });
  }
};
