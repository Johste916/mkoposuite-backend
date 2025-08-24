'use strict';
const { Op } = require('sequelize');
const { sequelize } = require('../models');
const { Parser: CsvParser } = require('json2csv');

/** Safe model getter */
const getModel = (n) => {
  const m = sequelize?.models?.[n];
  if (!m) throw Object.assign(new Error(`Model "${n}" not found`), { status: 500, expose: true });
  return m;
};

/** Only allow known columns */
const pick = (model, body) =>
  !model.rawAttributes
    ? body
    : Object.fromEntries(Object.entries(body || {}).filter(([k]) => model.rawAttributes[k]));

const hasAttr = (Model, attr) => Boolean(Model?.rawAttributes?.[attr]);
const toDate = (v) => { if (!v) return null; const d = new Date(v); return Number.isNaN(d.getTime()) ? null : d; };
const startOfDay = (d) => { const x = new Date(d); x.setHours(0,0,0,0); return x; };
const endOfDay   = (d) => { const x = new Date(d); x.setHours(23,59,59,999); return x; };

const buildWhere = (Model, { q, status, type, dateFrom, dateTo, collector, loanOfficer, includeDeleted }) => {
  const where = {};
  if (hasAttr(Model, 'deletedAt') && String(includeDeleted).toLowerCase() !== 'true') {
    where.deletedAt = null;
  }
  if (q) {
    const fields = ['type', 'collector', 'loanOfficer', 'status'].filter((f) => hasAttr(Model, f));
    if (fields.length) where[Op.or] = fields.map((f) => ({ [f]: { [Op.iLike]: `%${q}%` } }));
  }
  if (status && hasAttr(Model, 'status')) where.status = status; // pending|completed|cancelled
  if (type && hasAttr(Model, 'type')) where.type = type;         // FIELD|OFFICE|AGENCY
  if (collector && hasAttr(Model, 'collector')) where.collector = { [Op.iLike]: `%${collector}%` };
  if (loanOfficer && hasAttr(Model, 'loanOfficer')) where.loanOfficer = { [Op.iLike]: `%${loanOfficer}%` };

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
      return { ...where, date: { [Op.gte]: today, [Op.lte]: endToday } };
    case 'missed':
      return {
        ...where,
        date: { ...(where.date || {}), [Op.lt]: today },
        status: where.status === 'completed' ? where.status : { [Op.ne]: 'completed' },
      };
    case 'past-maturity':
    case 'past_maturity': {
      const n = Math.max(parseInt(extra.pastDays || '30', 10), 1);
      const threshold = startOfDay(new Date(Date.now() - n * 24 * 60 * 60 * 1000));
      return {
        ...where,
        date: { ...(where.date || {}), [Op.lt]: threshold },
        status: where.status === 'completed' ? where.status : { [Op.ne]: 'completed' },
      };
    }
    default:
      return where;
  }
};

const parseSort = (Model, sort) => {
  if (!sort) return [['date', 'DESC']];
  const parts = String(sort).split(',');
  const out = [];
  for (const p of parts) {
    const [field, dirRaw] = p.split(':');
    const dir = (dirRaw || 'ASC').toUpperCase() === 'DESC' ? 'DESC' : 'ASC';
    if (hasAttr(Model, field)) out.push([field, dir]);
  }
  return out.length ? out : [['date', 'DESC']];
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

const getSummary = async (Model, where) => {
  const total = await Model.count({ where });

  const byStatus = hasAttr(Model, 'status')
    ? Object.fromEntries(
        (await Model.findAll({
          attributes: ['status', [sequelize.fn('COUNT', sequelize.col('id')), 'count']],
          where, group: ['status'], raw: true,
        })).map((r) => [r.status, Number(r.count)])
      )
    : {};

  const byType = hasAttr(Model, 'type')
    ? Object.fromEntries(
        (await Model.findAll({
          attributes: ['type', [sequelize.fn('COUNT', sequelize.col('id')), 'count']],
          where, group: ['type'], raw: true,
        })).map((r) => [r.type, Number(r.count)])
      )
    : {};

  return { total, byStatus, byType };
};

/** Audit actor */
const getActorId = (req) => req.user?.id || req.headers['x-user-id'] || null;

/* ---------------- CRUD + LIST ---------------- */
exports.list = async (req, res) => {
  try {
    const Model = getModel('CollectionSheet');

    const page  = Math.max(parseInt(req.query.page  || '1', 10), 1);
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
      const rows = await Model.findAll({ where, order });
      return sendCsv(res, rows);
    }

    const [ { rows, count }, summary ] = await Promise.all([
      Model.findAndCountAll({ where, limit, offset, order }),
      (String(req.query.withSummary).toLowerCase() === '1' ||
       String(req.query.withSummary).toLowerCase() === 'true')
        ? getSummary(Model, where)
        : null
    ]);

    return res.json({ data: rows, pagination: { page, limit, total: count }, summary });
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

/** Optional restore (only works if you later add deletedAt) */
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

/* Change status for a sheet */
exports.changeStatus = async (req, res) => {
  try {
    const Model = getModel('CollectionSheet');
    const row = await Model.findByPk(req.params.id);
    if (!row) return res.status(404).json({ error: 'Not found' });

    const status = String(req.body?.status || '').toLowerCase();
    if (!['pending','completed','cancelled'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }
    await row.update({ status });
    return res.json({ ok: true, id: row.id, status: row.status });
  } catch (err) {
    const status = err.status || 500;
    return res.status(status).json({ error: err.expose ? err.message : 'Internal Server Error' });
  }
};

/* ---------------- BULK SMS ---------------- */
const normalizePhone = (p) => {
  if (!p) return null;
  const digits = String(p).replace(/[^\d+]/g, '');
  if (digits.startsWith('+')) return digits;
  if (digits.startsWith('00')) return `+${digits.slice(2)}`;
  return digits.length >= 10 ? `+${digits}` : null;
};

// lazy load optional models
let Communication, User;
try { ({ Communication, User } = require('../models')); } catch {}

exports.bulkSms = async (req, res) => {
  try {
    const { ids = [], message, to = 'collector', customPhones = [], dryRun } = req.body || {};
    if (!message || String(message).trim().length === 0) {
      return res.status(400).json({ error: 'Message is required' });
    }
    if (!Array.isArray(ids) && to !== 'custom') {
      return res.status(400).json({ error: 'ids must be an array' });
    }

    const Model = getModel('CollectionSheet');
    let recipients = [];

    if (to === 'custom') {
      recipients = (customPhones || []).map(normalizePhone).filter(Boolean);
    } else {
      const rows = await Model.findAll({
        where: { id: { [Op.in]: ids } },
        attributes: ['id', 'collector', 'loanOfficer', 'collectorId', 'loanOfficerId'],
      });

      const userIds = new Set();
      if (to === 'collector') {
        rows.forEach(r => r.collectorId && userIds.add(r.collectorId));
      } else if (to === 'loanOfficer') {
        rows.forEach(r => r.loanOfficerId && userIds.add(r.loanOfficerId));
      }

      let userPhones = {};
      if (User && userIds.size) {
        const userList = await User.findAll({
          where: { id: { [Op.in]: Array.from(userIds) } },
          attributes: ['id', 'phone', 'name']
        });
        userList.forEach(u => { userPhones[u.id] = normalizePhone(u.phone); });
      }

      rows.forEach(r => {
        const phoneById =
          to === 'collector' ? userPhones[r.collectorId] : userPhones[r.loanOfficerId];
        if (phoneById) recipients.push(phoneById);
      });

      recipients = Array.from(new Set(recipients.filter(Boolean)));
    }

    if (recipients.length === 0) {
      return res.status(400).json({ error: 'No recipients resolved from selection' });
    }

    if (dryRun) {
      return res.json({ ok: true, count: recipients.length, sample: recipients.slice(0, 5) });
    }

    // stub sender — replace with your SMS gateway
    const sendSms = async (_phone, _body) => ({ ok: true });

    let sent = 0, failed = 0;
    for (const phone of recipients) {
      const { ok } = await sendSms(phone, message).catch(() => ({ ok: false }));
      if (ok) {
        sent++;
        if (Communication) {
          await Communication.create({
            channel: 'sms',
            recipient: phone,
            subject: 'Bulk Collection Notice',
            body: message,
            status: 'sent',
          }).catch(() => {});
        }
      } else {
        failed++;
      }
    }

    return res.json({ ok: true, sent, failed, total: recipients.length });
  } catch (err) {
    const status = err.status || 500;
    return res.status(status).json({ error: err.expose ? err.message : 'Internal Server Error' });
  }
};
