'use strict';

const express = require('express');
const router = express.Router();

const { authenticateUser, requireAuth, authorizeRoles } =
  require('../../middleware/authMiddleware');

// Admin only
const ADMIN_ONLY = authorizeRoles('admin', 'director');

// Helpers to access models and tenant id
function getModels(req) {
  return req.app.get('models') || require('../../models');
}
function tenantIdFrom(req) {
  return req.headers['x-tenant-id'] || req.context?.tenantId || null;
}

/**
 * Resolve a suitable Sequelize model for "types".
 * Accepts several common names so we don't break your existing schema.
 */
function resolveTypeModel(models) {
  const candidates = ['Type', 'Types', 'AdminType', 'GenericType'];
  for (const key of candidates) {
    if (models[key]) return models[key];
  }
  // Last resort: try to find a model with attributes we need.
  for (const key of Object.keys(models)) {
    const M = models[key];
    if (M && M.rawAttributes) {
      const attrs = Object.keys(M.rawAttributes);
      if (attrs.includes('category') && attrs.includes('name')) return M;
    }
  }
  return null;
}

/** Shape normalizer when meta may be text/JSON */
function normalizeMeta(input) {
  if (input == null || input === '') return null;
  if (typeof input === 'object') return input;
  if (typeof input === 'string') {
    try { return JSON.parse(input); } catch { return input; }
  }
  return input;
}

/* ============================= Routes ============================= */

/**
 * GET /api/admin/types/:category
 * List types for a category (tenant-aware)
 */
router.get('/:category',
  authenticateUser, requireAuth, ADMIN_ONLY,
  async (req, res, next) => {
    try {
      const models = getModels(req);
      const Type = resolveTypeModel(models);
      if (!Type) return res.status(501).json({
        error: 'Types model not found. Expected one of: Type, Types, AdminType, GenericType. Create a model/table with fields at least (category, name, code, meta, tenantId).'
      });

      const tenantId = tenantIdFrom(req);
      const { category } = req.params;

      const where = { category };
      if (Type.rawAttributes.tenantId) where.tenantId = tenantId;

      const rows = await Type.findAll({
        where,
        order: [['name', 'ASC'], ['id', 'ASC']],
      });
      res.setHeader('X-Total-Count', String(rows.length || 0));
      return res.json(rows);
    } catch (e) { next(e); }
  }
);

/**
 * POST /api/admin/types/:category
 * Body: { name, code?, meta? }
 */
router.post('/:category',
  authenticateUser, requireAuth, ADMIN_ONLY,
  async (req, res, next) => {
    try {
      const models = getModels(req);
      const Type = resolveTypeModel(models);
      if (!Type) return res.status(501).json({
        error: 'Types model not found. Create a model/table with fields (category, name, code, meta, tenantId).'
      });

      const tenantId = tenantIdFrom(req);
      const { category } = req.params;
      const { name, code = null, meta = null } = req.body || {};

      if (!name || !String(name).trim()) {
        return res.status(400).json({ error: 'name is required' });
      }

      const payload = { category, name: String(name).trim(), code, meta: normalizeMeta(meta) };
      if (Type.rawAttributes.tenantId) payload.tenantId = tenantId;

      const created = await Type.create(payload);
      return res.status(201).json(created);
    } catch (e) { next(e); }
  }
);

/**
 * PUT /api/admin/types/:category/:id
 * Body: { name?, code?, meta? }
 */
router.put('/:category/:id',
  authenticateUser, requireAuth, ADMIN_ONLY,
  async (req, res, next) => {
    try {
      const models = getModels(req);
      const Type = resolveTypeModel(models);
      if (!Type) return res.status(501).json({
        error: 'Types model not found.'
      });

      const tenantId = tenantIdFrom(req);
      const { category, id } = req.params;

      const where = { id };
      if (Type.rawAttributes.category) where.category = category;
      if (Type.rawAttributes.tenantId) where.tenantId = tenantId;

      const row = await Type.findOne({ where });
      if (!row) return res.status(404).json({ error: 'Not found' });

      const patch = {};
      if (req.body.name !== undefined) patch.name = req.body.name;
      if (req.body.code !== undefined) patch.code = req.body.code;
      if (req.body.meta !== undefined) patch.meta = normalizeMeta(req.body.meta);

      await row.update(patch);
      return res.json(row);
    } catch (e) { next(e); }
  }
);

/**
 * DELETE /api/admin/types/:category/:id
 */
router.delete('/:category/:id',
  authenticateUser, requireAuth, ADMIN_ONLY,
  async (req, res, next) => {
    try {
      const models = getModels(req);
      const Type = resolveTypeModel(models);
      if (!Type) return res.status(501).json({ error: 'Types model not found.' });

      const tenantId = tenantIdFrom(req);
      const { category, id } = req.params;

      const where = { id };
      if (Type.rawAttributes.category) where.category = category;
      if (Type.rawAttributes.tenantId) where.tenantId = tenantId;

      const row = await Type.findOne({ where });
      if (!row) return res.status(404).json({ error: 'Not found' });

      await row.destroy();
      return res.status(204).end();
    } catch (e) { next(e); }
  }
);

module.exports = router;
