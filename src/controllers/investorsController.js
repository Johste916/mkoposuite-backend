'use strict';

const { v4: uuidv4 } = require('uuid');

let Investor, sequelize, Op;
let Setting;
try {
  ({ Investor, Setting, sequelize, Sequelize: { Op } } = require('../models'));
} catch (e) {
  const models = require('../models');
  Investor = models.Investor;
  Setting = models.Setting;
  sequelize = models.sequelize;
  Op = (models.Sequelize && models.Sequelize.Op) || undefined;
}

/** Settings key must match /^[A-Za-z0-9._-]+$/i — use underscores (no colons). */
const investorsKey = (tenantId) =>
  tenantId ? `tenant_${tenantId}_investors` : 'investors_default';

const pick = (obj = {}, keys = []) => {
  const out = {};
  for (const k of keys) if (Object.prototype.hasOwnProperty.call(obj, k)) out[k] = obj[k];
  return out;
};

function normalizeQuery(q = {}) {
  const page = Math.max(parseInt(q.page || '1', 10), 1);
  const pageSizeRaw = q.pageSize || q.limit || '25'; // accept both
  const pageSize = Math.min(Math.max(parseInt(pageSizeRaw, 10) || 25, 1), 200);
  const search = String(q.q || q.search || '').trim();
  const status = String(q.status || '').toUpperCase() || null;
  return { page, pageSize, search, status };
}

/* -------------------------------- DB MODE -------------------------------- */
async function dbList(req, res, tenantId) {
  const { page, pageSize, search, status } = normalizeQuery(req.query);
  const where = {};
  if (tenantId && Investor?.rawAttributes?.tenantId) where.tenantId = tenantId;
  if (status && Investor?.rawAttributes?.status) where.status = status;
  if (search && Op) {
    where[Op.or] = [
      { name: { [Op.iLike || Op.like]: `%${search}%` } },
      { phone: { [Op.iLike || Op.like]: `%${search}%` } },
      { email: { [Op.iLike || Op.like]: `%${search}%` } },
    ];
  }

  const { rows, count } = await Investor.findAndCountAll({
    where,
    order: [['name', 'ASC']],
    offset: (page - 1) * pageSize,
    limit: pageSize,
  });

  return res.json({
    data: rows,
    meta: { page, pageSize, total: count, pages: Math.ceil(count / pageSize) },
  });
}

async function dbGet(req, res, tenantId) {
  const where = { id: req.params.id };
  if (tenantId && Investor?.rawAttributes?.tenantId) where.tenantId = tenantId;

  const row = await Investor.findOne({ where });
  if (!row) return res.status(404).json({ message: 'Investor not found' });
  return res.json(row);
}

async function dbCreate(req, res, tenantId) {
  const body = pick(req.body, [
    'name',
    'phone',
    'email',
    'address',
    'notes',
    'status',
    'productsCount',
  ]);
  if (!body.name) return res.status(400).json({ message: 'name is required' });
  if (!body.phone && !body.email) return res.status(400).json({ message: 'phone or email is required' });
  if (!body.status && Investor?.rawAttributes?.status) body.status = 'ACTIVE';
  if (tenantId && Investor?.rawAttributes?.tenantId) body.tenantId = tenantId;
  if (typeof body.productsCount === 'undefined' && Investor?.rawAttributes?.productsCount) {
    body.productsCount = 0;
  }

  const created = await Investor.create(body);
  return res.status(201).json(created);
}

async function dbUpdate(req, res, tenantId) {
  const where = { id: req.params.id };
  if (tenantId && Investor?.rawAttributes?.tenantId) where.tenantId = tenantId;

  const row = await Investor.findOne({ where });
  if (!row) return res.status(404).json({ message: 'Investor not found' });

  const body = pick(req.body, [
    'name',
    'phone',
    'email',
    'address',
    'notes',
    'status',
    'productsCount',
  ]);
  await row.update(body);
  return res.json(row);
}

async function dbDelete(req, res, tenantId) {
  const where = { id: req.params.id };
  if (tenantId && Investor?.rawAttributes?.tenantId) where.tenantId = tenantId;

  const row = await Investor.findOne({ where });
  if (!row) return res.status(404).json({ message: 'Investor not found' });

  await row.destroy();
  return res.json({ ok: true });
}

/* -------------------------- SETTINGS (fallback) --------------------------- */
async function kvList(req, res, tenantId) {
  const { page, pageSize, search, status } = normalizeQuery(req.query);
  const key = investorsKey(tenantId);
  const all = (await Setting.get(key, [])) || [];
  let filtered = all;

  if (search) {
    const s = search.toLowerCase();
    filtered = filtered.filter((i) =>
      [i.name, i.phone, i.email].some((v) => String(v || '').toLowerCase().includes(s))
    );
  }
  if (status) filtered = filtered.filter((i) => String(i.status || '').toUpperCase() === status);

  const total = filtered.length;
  const start = (page - 1) * pageSize;
  const data = filtered.slice(start, start + pageSize);

  return res.json({ data, meta: { page, pageSize, total, pages: Math.ceil(total / pageSize) } });
}

async function kvGet(req, res, tenantId) {
  const key = investorsKey(tenantId);
  const all = (await Setting.get(key, [])) || [];
  const row = all.find((i) => String(i.id) === String(req.params.id));
  if (!row) return res.status(404).json({ message: 'Investor not found' });
  return res.json(row);
}

async function kvCreate(req, res, tenantId, userId) {
  const body = pick(req.body, [
    'name',
    'phone',
    'email',
    'address',
    'notes',
    'status',
    'productsCount',
  ]);
  if (!body.name) return res.status(400).json({ message: 'name is required' });
  if (!body.phone && !body.email) return res.status(400).json({ message: 'phone or email is required' });

  const key = investorsKey(tenantId);
  const all = (await Setting.get(key, [])) || [];
  const now = new Date().toISOString();
  const row = {
    id: uuidv4(),
    ...body,
    status: body.status || 'ACTIVE',
    productsCount: typeof body.productsCount === 'number' ? body.productsCount : 0,
    createdAt: now,
    updatedAt: now,
    createdBy: userId || null,
    updatedBy: userId || null,
  };
  await Setting.set(key, [...all, row], userId, userId);
  return res.status(201).json(row);
}

async function kvUpdate(req, res, tenantId, userId) {
  const key = investorsKey(tenantId);
  const all = (await Setting.get(key, [])) || [];
  const idx = all.findIndex((i) => String(i.id) === String(req.params.id));
  if (idx === -1) return res.status(404).json({ message: 'Investor not found' });

  const patch = pick(req.body, [
    'name',
    'phone',
    'email',
    'address',
    'notes',
    'status',
    'productsCount',
  ]);

  const updated = {
    ...all[idx],
    ...patch,
    updatedAt: new Date().toISOString(),
    updatedBy: userId || null,
  };
  const next = all.slice();
  next[idx] = updated;

  await Setting.set(key, next, userId, userId);
  return res.json(updated);
}

async function kvDelete(req, res, tenantId, userId) {
  const key = investorsKey(tenantId);
  const all = (await Setting.get(key, [])) || [];
  const next = all.filter((i) => String(i.id) !== String(req.params.id));
  await Setting.set(key, next, userId, userId);
  return res.json({ ok: true });
}

/* -------------------------------- Public API ------------------------------ */
exports.list = async (req, res) => {
  const tenantId = req.headers['x-tenant-id'] || null;
  if (Investor && typeof Investor.findAndCountAll === 'function') return dbList(req, res, tenantId);
  return kvList(req, res, tenantId);
};

exports.get = async (req, res) => {
  const tenantId = req.headers['x-tenant-id'] || null;
  if (Investor && typeof Investor.findOne === 'function') return dbGet(req, res, tenantId);
  return kvGet(req, res, tenantId);
};

exports.create = async (req, res) => {
  const tenantId = req.headers['x-tenant-id'] || null;
  const userId = req.user?.id || null;
  if (Investor && typeof Investor.create === 'function') return dbCreate(req, res, tenantId);
  return kvCreate(req, res, tenantId, userId);
};

exports.update = async (req, res) => {
  const tenantId = req.headers['x-tenant-id'] || null;
  const userId = req.user?.id || null;
  if (Investor && typeof Investor.update === 'function') return dbUpdate(req, res, tenantId);
  return kvUpdate(req, res, tenantId, userId);
};

exports.remove = async (req, res) => {
  const tenantId = req.headers['x-tenant-id'] || null;
  const userId = req.user?.id || null;
  if (Investor && typeof Investor.destroy === 'function') return dbDelete(req, res, tenantId);
  return kvDelete(req, res, tenantId, userId);
};
