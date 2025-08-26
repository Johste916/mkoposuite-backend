'use strict';
const { Op } = require('sequelize');
const { sequelize } = require('../models');

const getModel = (n) => {
  const m = sequelize?.models?.[n];
  if (!m) throw Object.assign(new Error(`Model "${n}" not found`), { status: 500, expose: true });
  return m;
};
const pick = (m, b) =>
  !m.rawAttributes ? b : Object.fromEntries(Object.entries(b).filter(([k]) => m.rawAttributes[k]));
const searchWhere = (m, q) => {
  if (!q) return {};
  const fields = ['type', 'reference', 'notes']; // safe defaults
  const present = fields.filter(f => m.rawAttributes?.[f]);
  return present.length ? { [Op.or]: present.map(f => ({ [f]: { [Op.iLike]: `%${q}%` } })) } : {};
};

exports.list = async (req, res) => {
  const Model = getModel('SavingsTransaction');
  const page = Math.max(parseInt(req.query.page || '1', 10), 1);
  const limit = Math.min(Math.max(parseInt(req.query.limit || '20', 10), 1), 200);
  const offset = (page - 1) * limit;

  const where = { ...searchWhere(Model, req.query.q) };
  if (req.query.borrowerId) where.borrowerId = req.query.borrowerId;
  if (req.query.type) where.type = req.query.type;
  if (req.query.status) where.status = req.query.status;

  if (req.query.start || req.query.end) {
    where.date = {};
    if (req.query.start) where.date[Op.gte] = req.query.start;
    if (req.query.end) where.date[Op.lte] = req.query.end;
  }

  const { rows, count } = await Model.findAndCountAll({ where, limit, offset, order: [['createdAt', 'DESC']] });
  res.json({ data: rows, pagination: { page, limit, total: count } });
};

exports.get = async (req, res) => {
  const Model = getModel('SavingsTransaction');
  const row = await Model.findByPk(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json(row);
};

exports.create = async (req, res) => {
  const Model = getModel('SavingsTransaction');
  const body = pick(Model, req.body);
  if (!body.type || !['deposit','withdrawal','charge','interest'].includes(body.type)) {
    return res.status(400).json({ error: 'Invalid type' });
  }
  if (!body.status) body.status = 'pending';
  if (!body.createdBy && req.user?.id) body.createdBy = String(req.user.id);
  const created = await Model.create(body);
  res.status(201).json(created);
};

exports.bulkCreate = async (req, res) => {
  const Model = getModel('SavingsTransaction');
  const items = Array.isArray(req.body?.items) ? req.body.items : [];
  if (!items.length) return res.status(400).json({ error: 'No items' });
  const mapped = items.map((x) => {
    const p = pick(Model, x);
    if (!p.status) p.status = 'pending';
    if (!p.createdBy && req.user?.id) p.createdBy = String(req.user.id);
    return p;
  });
  const created = await Model.bulkCreate(mapped, { returning: true });
  res.status(201).json({ count: created.length });
};

exports.update = async (req, res) => {
  const Model = getModel('SavingsTransaction');
  const row = await Model.findByPk(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  await row.update(pick(Model, req.body));
  res.json(row);
};

exports.reverse = async (req, res) => {
  const Model = getModel('SavingsTransaction');
  const row = await Model.findByPk(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  if (row.reversed === true) return res.json(row);
  await row.update({ reversed: true });
  res.json(row);
};

exports.approve = async (req, res) => {
  const Model = getModel('SavingsTransaction');
  const row = await Model.findByPk(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  const comment = (req.body?.comment || req.query?.comment || '').trim();
  if (!comment) return res.status(400).json({ error: 'approval comment is required' });
  await row.update({
    status: 'approved',
    approvedBy: req.user?.id ? String(req.user.id) : null,
    approvedAt: new Date(),
    approvalComment: comment,
  });
  res.json(row);
};

exports.reject = async (req, res) => {
  const Model = getModel('SavingsTransaction');
  const row = await Model.findByPk(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  const comment = (req.body?.comment || req.query?.comment || '').trim();
  if (!comment) return res.status(400).json({ error: 'rejection comment is required' });
  await row.update({
    status: 'rejected',
    approvedBy: req.user?.id ? String(req.user.id) : null,
    approvedAt: new Date(),
    approvalComment: comment,
  });
  res.json(row);
};

exports.remove = async (req, res) => {
  const Model = getModel('SavingsTransaction');
  const row = await Model.findByPk(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  await row.destroy();
  res.json({ ok: true });
};

exports.staffReport = async (req, res) => {
  const Model = getModel('SavingsTransaction');
  const where = {};
  if (req.query.start || req.query.end) {
    where.date = {};
    if (req.query.start) where.date[Op.gte] = req.query.start;
    if (req.query.end) where.date[Op.lte] = req.query.end;
  }
  const list = await Model.findAll({ where, order: [['createdBy','ASC']] });
  const map = new Map();
  for (const t of list) {
    const k = t.createdBy || 0;
    if (!map.has(k)) map.set(k, { staffId: k, staffName: null, deposit: 0, withdrawal: 0, charge: 0, interest: 0, approvedCount:0, pendingCount:0, rejectedCount:0 });
    const r = map.get(k);
    r[t.type] = Number(r[t.type] || 0) + Number(t.amount || 0);
    if (t.status === 'approved') r.approvedCount++;
    else if (t.status === 'pending') r.pendingCount++;
    else if (t.status === 'rejected') r.rejectedCount++;
  }
  res.json(Array.from(map.values()));
};
