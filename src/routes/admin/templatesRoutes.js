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
 * Resolve a suitable Sequelize model for "templates".
 * Accepts several common names so we don't break your existing schema.
 */
function resolveTemplateModel(models) {
  const candidates = ['Template', 'Templates', 'AdminTemplate', 'MessageTemplate'];
  for (const key of candidates) {
    if (models[key]) return models[key];
  }
  // Try to find by attributes
  for (const key of Object.keys(models)) {
    const M = models[key];
    if (M && M.rawAttributes) {
      const attrs = Object.keys(M.rawAttributes);
      const hasCore = attrs.includes('category') && attrs.includes('name') && attrs.includes('body');
      if (hasCore) return M;
    }
  }
  return null;
}

/* ============================= Routes ============================= */

/**
 * GET /api/admin/templates/:category
 * List templates for a category (tenant-aware)
 */
router.get('/:category',
  authenticateUser, requireAuth, ADMIN_ONLY,
  async (req, res, next) => {
    try {
      const models = getModels(req);
      const Template = resolveTemplateModel(models);
      if (!Template) return res.status(501).json({
        error: 'Templates model not found. Expected one of: Template, Templates, AdminTemplate, MessageTemplate. Create a model with fields (category, name, subject, body, channel, tenantId).'
      });

      const tenantId = tenantIdFrom(req);
      const { category } = req.params;

      const where = { category };
      if (Template.rawAttributes.tenantId) where.tenantId = tenantId;

      const rows = await Template.findAll({
        where,
        order: [['name', 'ASC'], ['id', 'ASC']],
      });
      res.setHeader('X-Total-Count', String(rows.length || 0));
      return res.json(rows);
    } catch (e) { next(e); }
  }
);

/**
 * POST /api/admin/templates/:category
 * Body: { name, subject?, body, channel?("email"|"sms") }
 */
router.post('/:category',
  authenticateUser, requireAuth, ADMIN_ONLY,
  async (req, res, next) => {
    try {
      const models = getModels(req);
      const Template = resolveTemplateModel(models);
      if (!Template) return res.status(501).json({
        error: 'Templates model not found. Create a model/table with fields (category, name, subject, body, channel, tenantId).'
      });

      const tenantId = tenantIdFrom(req);
      const { category } = req.params;
      const { name, subject = null, body, channel = 'email' } = req.body || {};

      if (!name || !String(name).trim()) {
        return res.status(400).json({ error: 'name is required' });
      }
      if (!body || !String(body).trim()) {
        return res.status(400).json({ error: 'body is required' });
      }

      const payload = {
        category,
        name: String(name).trim(),
        subject: subject == null ? null : String(subject),
        body: String(body),
        channel: channel || 'email',
      };
      if (Template.rawAttributes.tenantId) payload.tenantId = tenantId;

      const created = await Template.create(payload);
      return res.status(201).json(created);
    } catch (e) { next(e); }
  }
);

/**
 * PUT /api/admin/templates/:category/:id
 * Body: { name?, subject?, body?, channel? }
 */
router.put('/:category/:id',
  authenticateUser, requireAuth, ADMIN_ONLY,
  async (req, res, next) => {
    try {
      const models = getModels(req);
      const Template = resolveTemplateModel(models);
      if (!Template) return res.status(501).json({ error: 'Templates model not found.' });

      const tenantId = tenantIdFrom(req);
      const { category, id } = req.params;

      const where = { id };
      if (Template.rawAttributes.category) where.category = category;
      if (Template.rawAttributes.tenantId) where.tenantId = tenantId;

      const row = await Template.findOne({ where });
      if (!row) return res.status(404).json({ error: 'Not found' });

      const patch = {};
      if (req.body.name !== undefined) patch.name = req.body.name;
      if (req.body.subject !== undefined) patch.subject = req.body.subject;
      if (req.body.body !== undefined) patch.body = req.body.body;
      if (req.body.channel !== undefined) patch.channel = req.body.channel;

      await row.update(patch);
      return res.json(row);
    } catch (e) { next(e); }
  }
);

/**
 * DELETE /api/admin/templates/:category/:id
 */
router.delete('/:category/:id',
  authenticateUser, requireAuth, ADMIN_ONLY,
  async (req, res, next) => {
    try {
      const models = getModels(req);
      const Template = resolveTemplateModel(models);
      if (!Template) return res.status(501).json({ error: 'Templates model not found.' });

      const tenantId = tenantIdFrom(req);
      const { category, id } = req.params;

      const where = { id };
      if (Template.rawAttributes.category) where.category = category;
      if (Template.rawAttributes.tenantId) where.tenantId = tenantId;

      const row = await Template.findOne({ where });
      if (!row) return res.status(404).json({ error: 'Not found' });

      await row.destroy();
      return res.status(204).end();
    } catch (e) { next(e); }
  }
);

module.exports = router;
