'use strict';

const express = require('express');
const router = express.Router();
const { authenticateUser, requireAuth, authorizeRoles } = require('../middleware/authMiddleware');

// Helpers to access models safely
function getModels(req) {
  return req.app?.get('models') || (function tryRequire() {
    try { return require('../models'); } catch { try { return require('../../models'); } catch { return null; } }
  }());
}
function getModel(models, name) {
  return models?.[name] || models?.sequelize?.models?.[name] || null;
}
function ok(res, data, meta) {
  if (meta?.total != null) res.setHeader('X-Total-Count', String(meta.total));
  return res.json(data);
}

// Role guards
const ADMIN_ONLY = authorizeRoles('admin', 'director');
const ANY_AUTH   = requireAuth;

/**
 * GET /api/investors
 * Query: q, page=1, limit=50
 */
router.get('/', authenticateUser, ANY_AUTH, async (req, res, next) => {
  try {
    const models = getModels(req);
    const Investor = getModel(models, 'Investor');

    const page  = Math.max(1, parseInt(req.query.page || '1', 10));
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit || '50', 10)));
    const offset = (page - 1) * limit;
    const q = (req.query.q || '').trim();

    if (Investor && typeof Investor.findAndCountAll === 'function') {
      const where = {};
      if (q) {
        // Search by name/email if those columns exist
        const { Op } = require('sequelize');
        const ra = Investor.rawAttributes || {};
        const or = [];
        if (ra.name)  or.push({ name: { [Op.iLike]: `%${q}%` } });
        if (ra.email) or.push({ email: { [Op.iLike]: `%${q}%` } });
        if (or.length) where[Op.or] = or;
      }

      const { rows, count } = await Investor.findAndCountAll({
        where,
        order: [['createdAt', 'DESC']],
        limit,
        offset,
      });
      return ok(res, rows, { total: count });
    }

    // Fallback (no model): empty list, not an error
    return ok(res, [], { total: 0 });
  } catch (e) {
    next(e);
  }
});

/**
 * POST /api/investors
 */
router.post('/', authenticateUser, ADMIN_ONLY, async (req, res, next) => {
  try {
    const models = getModels(req);
    const Investor = getModel(models, 'Investor');

    if (!Investor) {
      // Soft-create response so UI proceeds, but signal not persisted
      return res.status(201).json({ ...req.body, id: Date.now(), _note: 'No Investor model; not persisted.' });
    }

    const rec = await Investor.create(req.body || {});
    return res.status(201).json(rec);
  } catch (e) {
    next(e);
  }
});

/**
 * GET /api/investors/:id
 */
router.get('/:id', authenticateUser, ANY_AUTH, async (req, res, next) => {
  try {
    const models = getModels(req);
    const Investor = getModel(models, 'Investor');

    if (!Investor) return res.json(null);

    const row = await Investor.findByPk(req.params.id);
    if (!row) return res.status(404).json({ error: 'Investor not found' });
    return res.json(row);
  } catch (e) { next(e); }
});

/**
 * PUT /api/investors/:id
 */
router.put('/:id', authenticateUser, ADMIN_ONLY, async (req, res, next) => {
  try {
    const models = getModels(req);
    const Investor = getModel(models, 'Investor');

    if (!Investor) return res.json({ id: req.params.id, ...req.body, _note: 'No Investor model; not persisted.' });

    const row = await Investor.findByPk(req.params.id);
    if (!row) return res.status(404).json({ error: 'Investor not found' });
    await row.update(req.body || {});
    return res.json(row);
  } catch (e) { next(e); }
});

/**
 * DELETE /api/investors/:id
 */
router.delete('/:id', authenticateUser, ADMIN_ONLY, async (req, res, next) => {
  try {
    const models = getModels(req);
    const Investor = getModel(models, 'Investor');

    if (!Investor) return res.status(204).end();

    const n = await Investor.destroy({ where: { id: req.params.id } });
    if (!n) return res.status(404).json({ error: 'Investor not found' });
    return res.status(204).end();
  } catch (e) { next(e); }
});

module.exports = router;
