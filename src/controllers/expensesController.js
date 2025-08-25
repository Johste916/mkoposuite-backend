// src/controllers/expensesController.js
'use strict';
const { Op } = require('sequelize');
const { sequelize } = require('../models');
const { resolveTenantId } = require('../lib/tenant');

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

exports.list = async (req, res) => {
  try {
    const Expense = getModel('Expense');
    const tenantId = resolveTenantId(req);          // optional fallback
    const page  = Math.max(parseInt(req.query.page || '1', 10), 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit || '20', 10), 1), 200);
    const offset = (page - 1) * limit;

    const where = { ...(tenantId ? { tenantId } : {}), ...searchWhere(Expense, req.query.q) };
    const { rows, count } = await Expense.findAndCountAll({
      where,
      limit,
      offset,
      order: [['date','DESC'], ['createdAt','DESC']],
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
    const row = await Expense.findOne({ where: { id: req.params.id, ...(tenantId ? { tenantId } : {}) } });
    if (!row) return res.status(404).json({ error: 'Not found' });
    res.json(row);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.expose ? err.message : 'Internal Server Error' });
  }
};

exports.create = async (req, res) => {
  try {
    const Expense = getModel('Expense');
    const tenantId = resolveTenantId(req, { requireForWrite: true }); // only enforced when mode=enforced
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
