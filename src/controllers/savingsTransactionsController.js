'use strict';
const { Op } = require('sequelize');
const { sequelize } = require('../models');

const getModel = (n) => {
  const m = sequelize?.models?.[n];
  if (!m) throw Object.assign(new Error(`Model "${n}" not found`), { status: 500, expose: true });
  return m;
};
const pick = (m, b) => !m.rawAttributes ? b : Object.fromEntries(Object.entries(b).filter(([k]) => m.rawAttributes[k]));
const searchWhere = (m, q) => {
  if (!q) return {};
  const fields = ['type', 'reference', 'borrowerName', 'staffName'].filter(f => m.rawAttributes?.[f]);
  return fields.length ? { [Op.or]: fields.map(f => ({ [f]: { [Op.iLike]: `%${q}%` } })) } : {};
};

exports.list = async (req, res) => {
  const Model = getModel('SavingsTransaction');
  const page = Math.max(parseInt(req.query.page || '1', 10), 1);
  const limit = Math.min(Math.max(parseInt(req.query.limit || '20', 10), 1), 200);
  const offset = (page - 1) * limit;

  const where = searchWhere(Model, req.query.q);
  if (req.query.accountId && Model.rawAttributes.accountId) where.accountId = req.query.accountId;
  if (req.query.type && Model.rawAttributes.type) where.type = req.query.type;

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
  const created = await Model.create(pick(Model, req.body));
  res.status(201).json(created);
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

exports.remove = async (req, res) => {
  const Model = getModel('SavingsTransaction');
  const row = await Model.findByPk(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  await row.destroy();
  res.json({ ok: true });
};
