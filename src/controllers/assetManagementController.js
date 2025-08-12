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
  const fields = ['name', 'category', 'status', 'serialNumber'].filter(f => m.rawAttributes?.[f]);
  return fields.length ? { [Op.or]: fields.map(f => ({ [f]: { [Op.iLike]: `%${q}%` } })) } : {};
};

exports.list = async (req, res) => {
  const Model = getModel('Asset');
  const page = Math.max(parseInt(req.query.page || '1', 10), 1);
  const limit = Math.min(Math.max(parseInt(req.query.limit || '20', 10), 1), 200);
  const offset = (page - 1) * limit;
  const where = searchWhere(Model, req.query.q);
  const { rows, count } = await Model.findAndCountAll({ where, limit, offset, order: [['createdAt', 'DESC']] });
  res.json({ data: rows, pagination: { page, limit, total: count } });
};

exports.get = async (req, res) => {
  const Model = getModel('Asset');
  const row = await Model.findByPk(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json(row);
};

exports.create = async (req, res) => {
  const Model = getModel('Asset');
  const created = await Model.create(pick(Model, req.body));
  res.status(201).json(created);
};

exports.update = async (req, res) => {
  const Model = getModel('Asset');
  const row = await Model.findByPk(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  await row.update(pick(Model, req.body));
  res.json(row);
};

exports.remove = async (req, res) => {
  const Model = getModel('Asset');
  const row = await Model.findByPk(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  await row.destroy();
  res.json({ ok: true });
};
