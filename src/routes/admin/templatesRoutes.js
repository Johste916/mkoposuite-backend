'use strict';
const express = require('express');
const router = express.Router();

const { authenticateUser, requireAuth, authorizeRoles } = require('../../middleware/authMiddleware');
const ADMIN_ONLY = authorizeRoles('admin', 'director');

function getModels(req) {
  return req.app.get('models') || require('../../models');
}

router.get('/', authenticateUser, requireAuth, async (req, res, next) => {
  try {
    const { channel, category } = req.query;
    const where = {};
    if (channel) where.channel = channel;
    if (category) where.category = category;

    const { AdminTemplate } = getModels(req);
    const rows = await AdminTemplate.findAll({ where, order: [['name','ASC']] });
    res.setHeader('X-Total-Count', String(rows.length || 0));
    res.json(rows);
  } catch (e) { next(e); }
});

router.post('/', authenticateUser, ADMIN_ONLY, async (req, res, next) => {
  try {
    const { AdminTemplate } = getModels(req);
    const payload = req.body || {};
    if (!payload.channel)  return res.status(400).json({ error: 'channel is required' });
    const row = await AdminTemplate.create(payload);
    res.status(201).json(row);
  } catch (e) { next(e); }
});

router.put('/:id', authenticateUser, ADMIN_ONLY, async (req, res, next) => {
  try {
    const { AdminTemplate } = getModels(req);
    const row = await AdminTemplate.findByPk(req.params.id);
    if (!row) return res.status(404).json({ error: 'Not found' });
    await row.update(req.body || {});
    res.json(row);
  } catch (e) { next(e); }
});

router.delete('/:id', authenticateUser, ADMIN_ONLY, async (req, res, next) => {
  try {
    const { AdminTemplate } = getModels(req);
    const row = await AdminTemplate.findByPk(req.params.id);
    if (!row) return res.status(404).json({ error: 'Not found' });
    await row.destroy();
    res.status(204).end();
  } catch (e) { next(e); }
});

module.exports = router;
