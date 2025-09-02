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
    const { category } = req.query;
    if (!category) return res.status(400).json({ error: 'category is required' });
    const { AdminType } = getModels(req);
    const rows = await AdminType.findAll({ where: { category }, order: [['name','ASC']] });
    res.setHeader('X-Total-Count', String(rows.length || 0));
    res.json(rows);
  } catch (e) { next(e); }
});

router.post('/', authenticateUser, ADMIN_ONLY, async (req, res, next) => {
  try {
    const { AdminType } = getModels(req);
    const payload = req.body || {};
    if (!payload.category) return res.status(400).json({ error: 'category is required' });
    const row = await AdminType.create(payload);
    res.status(201).json(row);
  } catch (e) { next(e); }
});

router.put('/:id', authenticateUser, ADMIN_ONLY, async (req, res, next) => {
  try {
    const { AdminType } = getModels(req);
    const row = await AdminType.findByPk(req.params.id);
    if (!row) return res.status(404).json({ error: 'Not found' });
    await row.update(req.body || {});
    res.json(row);
  } catch (e) { next(e); }
});

router.delete('/:id', authenticateUser, ADMIN_ONLY, async (req, res, next) => {
  try {
    const { AdminType } = getModels(req);
    const row = await AdminType.findByPk(req.params.id);
    if (!row) return res.status(404).json({ error: 'Not found' });
    await row.destroy();
    res.status(204).end();
  } catch (e) { next(e); }
});

module.exports = router;
