'use strict';

const { v4: uuidv4 } = require('uuid');

let Branch, sequelize, Op;
let Setting;
try {
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

/* -------------------------------- Helpers --------------------------------- */
const pick = (obj = {}, keys = []) => {
  const out = {};
  for (const k of keys) if (Object.prototype.hasOwnProperty.call(obj, k)) out[k] = obj[k];
  return out;
};

const hasAttr = (model, key) =>
  Boolean(model?.rawAttributes && model.rawAttributes[key]);

/** Keep only fields that are actual model attributes; also accept snake_case field names. */
function pickModelFields(model, payload = {}) {
  if (!model?.rawAttributes || !payload) return payload || {};
  const out = {};
  for (const [attrKey, def] of Object.entries(model.rawAttributes)) {
    if (Object.prototype.hasOwnProperty.call(payload, attrKey)) {
      out[attrKey] = payload[attrKey];
      continue;
    }
    // allow API clients to send the underlying DB field name
    if (def?.field && Object.prototype.hasOwnProperty.call(payload, def.field)) {
      out[attrKey] = payload[def.field];
    }
  }
  return out;
}

function normalizeQuery(q = {}) {
  const page = Math.max(parseInt(q.page || '1', 10), 1);
  const pageSizeRaw = q.pageSize || q.limit || '25';
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
  return String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/* -------------------------------- DB MODE --------------------------------- */
async function dbList(req, res, tenantId) {
  const { page, pageSize, search, active } = normalizeQuery(req.query);
  const where = {};

  if (tenantId && hasAttr(Branch, 'tenantId')) where.tenantId = tenantId;
  if (active !== null && hasAttr(Branch, 'isActive')) where.isActive = active;

  // Search only across attributes that exist
  if (search && Op) {
    const like = Op.iLike || Op.like;
    const ors = [];
    if (hasAttr(Branch, 'name'))  ors.push({ name: { [like]: `%${search}%` } });
    if (hasAttr(Branch, 'code'))  ors.push({ code: { [like]: `%${search}%` } });
    if (hasAttr(Branch, 'city'))  ors.push({ city: { [like]: `%${search}%` } });
    if (ors.length) where[Op.or] = ors;
  }

  // Safe ordering
  const order = hasAttr(Branch, 'name')
    ? [['name', 'ASC']]
    : hasAttr(Branch, 'createdAt')
    ? [['createdAt', 'DESC']]
    : hasAttr(Branch, 'id')
    ? [['id', 'ASC']]
    : undefined;

  const { rows, count } = await Branch.findAndCountAll({
    where,
    order,
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
  if (tenantId && hasAttr(Branch, 'tenantId')) where.tenantId = tenantId;

  const row = await Branch.findOne({ where });
  if (!row) return res.status(404).json({ message: 'Branch not found' });
  return res.json(row);
}

async function dbCreate(req, res, tenantId) {
  // Accept only known fields, then set safe defaults
  const incoming = pick(req.body, [
    'name', 'code', 'phone', 'email', 'address', 'city', 'country', 'isActive',
  ]);

  if (!incoming.name) return res.status(400).json({ message: 'name is required' });
  if (!incoming.code) incoming.code = codeFromName(incoming.name);

  // Filter to model attributes only (prevents unknown columns like isActive when absent)
  let body = pickModelFields(Branch, incoming);

  if (tenantId && hasAttr(Branch, 'tenantId')) body.tenantId = tenantId;
  if (hasAttr(Branch, 'isActive') && typeof body.isActive === 'undefined') body.isActive = true;

  const created = await Branch.create(body);
  return res.status(201).json(created);
}

async function dbUpdate(req, res, tenantId) {
  const where = { id: req.params.id };
  if (tenantId && hasAttr(Branch, 'tenantId')) where.tenantId = tenantId;

  const row = await Branch.findOne({ where });
  if (!row) return res.status(404).json({ message: 'Branch not found' });

  const incoming = pick(req.body, [
    'name', 'code', 'phone', 'email', 'address', 'city', 'country', 'isActive',
  ]);
  if (incoming.name && !incoming.code) incoming.code = codeFromName(incoming.name);

  const patch = pickModelFields(Branch, incoming);

  await row.update(patch);
  return res.json(row);
}

async function dbDelete(req, res, tenantId) {
  const where = { id: req.params.id };
  if (tenantId && hasAttr(Branch, 'tenantId')) where.tenantId = tenantId;

  const row = await Branch.findOne({ where });
  if (!row) return res.status(404).json({ message: 'Branch not found' });

  await row.destroy();
  return res.json({ ok: true });
}

/* --------------------------- SETTINGS (fallback) --------------------------- */
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
    'name', 'code', 'phone', 'email', 'address', 'city', 'country', 'isActive',
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

  const patch0 = pick(req.body, [
    'name', 'code', 'phone', 'email', 'address', 'city', 'country', 'isActive',
  ]);
  if (patch0.name && !patch0.code) patch0.code = codeFromName(patch0.name);

  const updated = {
    ...all[idx],
    ...patch0,
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

/* -------------------------------- Public API ------------------------------- */
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
