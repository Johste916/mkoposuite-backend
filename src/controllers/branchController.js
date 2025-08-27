'use strict';

const { v4: uuidv4 } = require('uuid');

let Branch, sequelize, Op;
let Setting;
try {
  // Prefer a single import to avoid duplicate instances
  ({ Branch, Setting, sequelize, Sequelize: { Op } } = require('../models'));
} catch (e) {
  const models = require('../models');
  Branch = models.Branch;
  Setting = models.Setting;
  sequelize = models.sequelize;
  Op = (models.Sequelize && models.Sequelize.Op) || undefined;
}

/** Settings key must match /^[A-Za-z0-9._-]+$/i — use underscores (no colons). */
const branchesKey = (tenantId) =>
  tenantId ? `tenant_${tenantId}_branches` : 'branches_default';

/* ------------------------------- Helpers --------------------------------- */
const pick = (obj = {}, keys = []) => {
  const out = {};
  for (const k of keys) if (Object.prototype.hasOwnProperty.call(obj, k)) out[k] = obj[k];
  return out;
};

function normalizeQuery(q = {}) {
  const page = Math.max(parseInt(q.page || '1', 10), 1);
  const pageSizeRaw = q.pageSize || q.limit || '25'; // accept both pageSize & limit
  const pageSize = Math.min(Math.max(parseInt(pageSizeRaw, 10) || 25, 1), 200);
  const search = String(q.q || q.search || '').trim();
  const active =
    typeof q.active === 'string'
      ? q.active.toLowerCase() === 'true'
        ? true
        : q.active.toLowerCase() === 'false'
        ? false
        : null
      : null;
  return { page, pageSize, search, active };
}

function codeFromName(name = '') {
  return String(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/* ------------------------------- DB MODE --------------------------------- */
async function dbList(req, res, tenantId) {
  const { page, pageSize, search, active } = normalizeQuery(req.query);
  const where = {};
  if (tenantId && Branch?.rawAttributes?.tenantId) where.tenantId = tenantId;
  if (active !== null && Branch?.rawAttributes?.isActive) where.isActive = active;
  if (search && Op) {
    where[Op.or] = [
      { name: { [Op.iLike || Op.like]: `%${search}%` } },
      { code: { [Op.iLike || Op.like]: `%${search}%` } },
      { city: { [Op.iLike || Op.like]: `%${search}%` } },
    ];
  }

  const { rows, count } = await Branch.findAndCountAll({
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
  if (tenantId && Branch?.rawAttributes?.tenantId) where.tenantId = tenantId;

  const row = await Branch.findOne({ where });
  if (!row) return res.status(404).json({ message: 'Branch not found' });
  return res.json(row);
}

async function dbCreate(req, res, tenantId) {
  const body = pick(req.body, [
    'name',
    'code',
    'phone',
    'email',
    'address',
    'city',
    'country',
    'isActive',
  ]);
  if (!body.name) return res.status(400).json({ message: 'name is required' });
  if (!body.code) body.code = codeFromName(body.name);
  if (tenantId && Branch?.rawAttributes?.tenantId) body.tenantId = tenantId;
  if (typeof body.isActive === 'undefined' && Branch?.rawAttributes?.isActive) body.isActive = true;

  const created = await Branch.create(body);
  return res.status(201).json(created);
}

async function dbUpdate(req, res, tenantId) {
  const where = { id: req.params.id };
  if (tenantId && Branch?.rawAttributes?.tenantId) where.tenantId = tenantId;

  const row = await Branch.findOne({ where });
  if (!row) return res.status(404).json({ message: 'Branch not found' });

  const body = pick(req.body, [
    'name',
    'code',
    'phone',
    'email',
    'address',
    'city',
    'country',
    'isActive',
  ]);
  if (body.name && !body.code) body.code = codeFromName(body.name);

  await row.update(body);
  return res.json(row);
}

async function dbDelete(req, res, tenantId) {
  const where = { id: req.params.id };
  if (tenantId && Branch?.rawAttributes?.tenantId) where.tenantId = tenantId;

  const row = await Branch.findOne({ where });
  if (!row) return res.status(404).json({ message: 'Branch not found' });

  await row.destroy();
  return res.json({ ok: true });
}

/* --------------------------- SETTINGS (fallback) -------------------------- */
async function kvList(req, res, tenantId) {
  const { page, pageSize, search, active } = normalizeQuery(req.query);
  const key = branchesKey(tenantId);
  const all = (await Setting.get(key, [])) || [];
  let filtered = all;

  if (search) {
    const s = search.toLowerCase();
    filtered = filtered.filter((b) =>
      [b.name, b.code, b.city, b.country].some((v) => String(v || '').toLowerCase().includes(s))
    );
  }
  if (active !== null) filtered = filtered.filter((b) => Boolean(b.isActive) === active);

  const total = filtered.length;
  const start = (page - 1) * pageSize;
  const data = filtered.slice(start, start + pageSize);

  return res.json({ data, meta: { page, pageSize, total, pages: Math.ceil(total / pageSize) } });
}

async function kvGet(req, res, tenantId) {
  const key = branchesKey(tenantId);
  const all = (await Setting.get(key, [])) || [];
  const row = all.find((b) => String(b.id) === String(req.params.id));
  if (!row) return res.status(404).json({ message: 'Branch not found' });
  return res.json(row);
}

async function kvCreate(req, res, tenantId, userId) {
  const body = pick(req.body, [
    'name',
    'code',
    'phone',
    'email',
    'address',
    'city',
    'country',
    'isActive',
  ]);
  if (!body.name) return res.status(400).json({ message: 'name is required' });
  if (!body.code) body.code = codeFromName(body.name);

  const key = branchesKey(tenantId);
  const all = (await Setting.get(key, [])) || [];
  const now = new Date().toISOString();
  const row = {
    id: uuidv4(),
    ...body,
    isActive: typeof body.isActive === 'boolean' ? body.isActive : true,
    createdAt: now,
    updatedAt: now,
    createdBy: userId || null,
    updatedBy: userId || null,
  };
  await Setting.set(key, [...all, row], userId, userId);
  return res.status(201).json(row);
}

async function kvUpdate(req, res, tenantId, userId) {
  const key = branchesKey(tenantId);
  const all = (await Setting.get(key, [])) || [];
  const idx = all.findIndex((b) => String(b.id) === String(req.params.id));
  if (idx === -1) return res.status(404).json({ message: 'Branch not found' });

  const patch = pick(req.body, [
    'name',
    'code',
    'phone',
    'email',
    'address',
    'city',
    'country',
    'isActive',
  ]);
  if (patch.name && !patch.code) patch.code = codeFromName(patch.name);

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
  const key = branchesKey(tenantId);
  const all = (await Setting.get(key, [])) || [];
  const next = all.filter((b) => String(b.id) !== String(req.params.id));
  await Setting.set(key, next, userId, userId);
  return res.json({ ok: true });
}

/* ------------------------------- Public API ------------------------------- */
exports.list = async (req, res) => {
  const tenantId = req.headers['x-tenant-id'] || null;
  if (Branch && typeof Branch.findAndCountAll === 'function') return dbList(req, res, tenantId);
  return kvList(req, res, tenantId);
};

exports.get = async (req, res) => {
  const tenantId = req.headers['x-tenant-id'] || null;
  if (Branch && typeof Branch.findOne === 'function') return dbGet(req, res, tenantId);
  return kvGet(req, res, tenantId);
};

exports.create = async (req, res) => {
  const tenantId = req.headers['x-tenant-id'] || null;
  const userId = req.user?.id || null;
  if (Branch && typeof Branch.create === 'function') return dbCreate(req, res, tenantId);
  return kvCreate(req, res, tenantId, userId);
};

exports.update = async (req, res) => {
  const tenantId = req.headers['x-tenant-id'] || null;
  const userId = req.user?.id || null;
  if (Branch && typeof Branch.update === 'function') return dbUpdate(req, res, tenantId);
  return kvUpdate(req, res, tenantId, userId);
};

exports.remove = async (req, res) => {
  const tenantId = req.headers['x-tenant-id'] || null;
  const userId = req.user?.id || null;
  if (Branch && typeof Branch.destroy === 'function') return dbDelete(req, res, tenantId);
  return kvDelete(req, res, tenantId, userId);
};
