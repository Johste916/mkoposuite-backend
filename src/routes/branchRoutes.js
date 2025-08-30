'use strict';

const express = require('express');
const { Op } = require('sequelize');
const router = express.Router();

let db = {};
try { db = require('../models'); } catch {}
const { allow } = require('../middleware/permissions');

// Helpers
const getModel = (name) => {
  const m = db?.[name] || db?.sequelize?.models?.[name];
  if (!m) throw Object.assign(new Error(`Model "${name}" not found`), { status: 500, expose: true });
  return m;
};
const tenantFilter = (model, req) => {
  const key = model?.rawAttributes?.tenantId ? 'tenantId'
            : model?.rawAttributes?.tenant_id ? 'tenant_id' : null;
  const tenantId =
    req?.tenant?.id ||
    req?.headers?.['x-tenant-id'] ||
    process.env.DEFAULT_TENANT_ID ||
    null;
  return key && tenantId ? { [key]: tenantId } : {};
};

// Only pick attributes that exist on the table (prevents 42703 unknown column)
const pickAllowed = (model, src) => {
  const out = {};
  const attrs = model.rawAttributes || {};
  for (const [k, v] of Object.entries(src || {})) {
    if (attrs[k]) out[k] = v;
  }
  return out;
};

/**
 * NOTE ABOUT /api/branches:
 * Your server already defines a simple fallback GET "/api/branches" earlier.
 * To avoid clashing with that, this router exposes:
 *   - GET  /api/branches/list       -> full list with filters
 *   - GET  /api/branches/:id
 *   - POST /api/branches
 *   - PUT  /api/branches/:id
 *   - DELETE /api/branches/:id
 */

// List (with optional q search & status filter)
router.get('/list', async (req, res, next) => {
  try {
    const Branch = getModel('Branch');
    const where = { ...tenantFilter(Branch, req) };
    if (req.query.status) where.status = req.query.status;
    if (req.query.q) {
      where[Op.or] = [
        { name: { [Op.iLike]: `%${req.query.q}%` } },
        { code: { [Op.iLike]: `%${req.query.q}%` } },
      ];
    }
    const rows = await Branch.findAll({ where, order: [['name', 'ASC']] });
    res.set('X-Total-Count', String(rows.length));
    res.json({ items: rows });
  } catch (e) { next(e); }
});

// Details
router.get('/:id', async (req, res, next) => {
  try {
    const Branch = getModel('Branch');
    const where = { id: req.params.id, ...tenantFilter(Branch, req) };
    const row = await Branch.findOne({ where });
    if (!row) return res.status(404).json({ error: 'Branch not found' });
    res.json(row);
  } catch (e) { next(e); }
});

// Create (permission: branches:manage; default allows admin per your middleware)
router.post('/', allow('branches:manage'), async (req, res, next) => {
  try {
    const Branch = getModel('Branch');
    const payload = pickAllowed(Branch, { ...req.body, ...tenantFilter(Branch, req) });

    if (!payload.name || !payload.code) {
      return res.status(400).json({ error: 'name and code are required' });
    }
    // Normalize small things
    if (typeof payload.code === 'string') payload.code = payload.code.trim().toUpperCase();

    const row = await Branch.create(payload);
    res.status(201).json(row);
  } catch (e) { next(e); }
});

// Update
router.put('/:id', allow('branches:manage'), async (req, res, next) => {
  try {
    const Branch = getModel('Branch');
    const where = { id: req.params.id, ...tenantFilter(Branch, req) };
    const row = await Branch.findOne({ where });
    if (!row) return res.status(404).json({ error: 'Branch not found' });

    const payload = pickAllowed(Branch, req.body);
    if (payload.code && typeof payload.code === 'string') payload.code = payload.code.trim().toUpperCase();

    await row.update(payload);
    res.json(row);
  } catch (e) { next(e); }
});

// Delete (soft if "deletedAt" exists; otherwise hard)
router.delete('/:id', allow('branches:manage'), async (req, res, next) => {
  try {
    const Branch = getModel('Branch');
    const where = { id: req.params.id, ...tenantFilter(Branch, req) };
    const row = await Branch.findOne({ where });
    if (!row) return res.status(404).json({ error: 'Branch not found' });

    await row.destroy(); // respects paranoid when "deletedAt" column exists
    res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;
