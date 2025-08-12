'use strict';
const { Op } = require('sequelize');
const { sequelize } = require('../models');

const getModel = (name) => {
  const m = sequelize?.models?.[name];
  if (!m) throw Object.assign(new Error(`Model "${name}" not found`), { status: 500, expose: true });
  return m;
};
const pick = (model, payload) =>
  !model.rawAttributes ? payload : Object.fromEntries(Object.entries(payload).filter(([k]) => model.rawAttributes[k]));
const searchWhere = (model, q) => {
  if (!q) return {};
  const fields = ['name', 'item', 'model', 'serialNumber', 'status', 'borrowerName'].filter(f => model.rawAttributes?.[f]);
  return fields.length ? { [Op.or]: fields.map(f => ({ [f]: { [Op.iLike]: `%${q}%` } })) } : {};
};

exports.list = async (req, res) => {
  const Collateral = getModel('Collateral');
  const page = Math.max(parseInt(req.query.page || '1', 10), 1);
  const limit = Math.min(Math.max(parseInt(req.query.limit || '20', 10), 1), 200);
  const offset = (page - 1) * limit;
  const where = searchWhere(Collateral, req.query.q);

  const { rows, count } = await Collateral.findAndCountAll({ where, limit, offset, order: [['createdAt', 'DESC']] });
  res.json({ data: rows, pagination: { page, limit, total: count } });
};

exports.get = async (req, res) => {
  const Collateral = getModel('Collateral');
  const row = await Collateral.findByPk(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json(row);
};

exports.create = async (req, res) => {
  const Collateral = getModel('Collateral');
  const created = await Collateral.create(pick(Collateral, req.body));
  res.status(201).json(created);
};

exports.update = async (req, res) => {
  const Collateral = getModel('Collateral');
  const row = await Collateral.findByPk(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  await row.update(pick(Collateral, req.body));
  res.json(row);
};

exports.remove = async (req, res) => {
  const Collateral = getModel('Collateral');
  const row = await Collateral.findByPk(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  await row.destroy();
  res.json({ ok: true });
};
