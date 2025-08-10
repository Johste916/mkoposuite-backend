// src/controllers/loanProductController.js
const { Op } = require('sequelize');
const { LoanProduct } = require('../models');

const toNum = (v) => (v == null ? null : Number(v));

exports.list = async (req, res) => {
  try {
    const { q = '', status, page = 1, pageSize = 50 } = req.query;
    const where = {};
    if (status) where.status = status;
    if (q) where[Op.or] = [{ name: { [Op.iLike]: `%${q}%` } }, { code: { [Op.iLike]: `%${q}%` } }];

    const limit = Math.max(1, Number(pageSize));
    const offset = (Math.max(1, Number(page)) - 1) * limit;

    const { rows, count } = await LoanProduct.findAndCountAll({
      where,
      order: [['createdAt', 'DESC']],
      limit,
      offset,
    });

    res.json({ items: rows, total: count });
  } catch (e) {
    console.error('LoanProduct list error:', e);
    res.status(500).json({ error: 'Failed to fetch products' });
  }
};

exports.get = async (req, res) => {
  try {
    const row = await LoanProduct.findByPk(req.params.id);
    if (!row) return res.status(404).json({ error: 'Not found' });
    res.json(row);
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch product' });
  }
};

exports.create = async (req, res) => {
  try {
    const payload = {
      name: req.body.name,
      code: req.body.code,
      status: req.body.status || 'active',

      interestMethod: req.body.interestMethod || 'flat',
      interestRate: toNum(req.body.interestRate) ?? 0,

      minPrincipal: toNum(req.body.minPrincipal),
      maxPrincipal: toNum(req.body.maxPrincipal),
      minTermMonths: req.body.minTermMonths ?? null,
      maxTermMonths: req.body.maxTermMonths ?? null,

      penaltyRate: toNum(req.body.penaltyRate),

      fees: Array.isArray(req.body.fees) ? req.body.fees : [],
      eligibility: req.body.eligibility || {},
    };
    if (!payload.name || !payload.code) {
      return res.status(400).json({ error: 'name and code are required' });
    }

    const created = await LoanProduct.create(payload);
    res.status(201).json(created);
  } catch (e) {
    console.error('LoanProduct create error:', e);
    res.status(500).json({ error: 'Failed to create product' });
  }
};

exports.update = async (req, res) => {
  try {
    const row = await LoanProduct.findByPk(req.params.id);
    if (!row) return res.status(404).json({ error: 'Not found' });

    const updatable = [
      'name','code','status','interestMethod','interestRate',
      'minPrincipal','maxPrincipal','minTermMonths','maxTermMonths',
      'penaltyRate','fees','eligibility'
    ];
    const payload = {};
    for (const k of updatable) if (k in req.body) payload[k] = req.body[k];

    await row.update(payload);
    res.json(row);
  } catch (e) {
    console.error('LoanProduct update error:', e);
    res.status(500).json({ error: 'Failed to update product' });
  }
};

exports.remove = async (req, res) => {
  try {
    const row = await LoanProduct.findByPk(req.params.id);
    if (!row) return res.status(404).json({ error: 'Not found' });
    await row.destroy();
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Failed to delete product' });
  }
};

exports.toggleStatus = async (req, res) => {
  try {
    const row = await LoanProduct.findByPk(req.params.id);
    if (!row) return res.status(404).json({ error: 'Not found' });
    const next = row.status === 'active' ? 'inactive' : 'active';
    await row.update({ status: next });
    res.json({ id: row.id, status: row.status });
  } catch (e) {
    res.status(500).json({ error: 'Failed to toggle status' });
  }
};
