'use strict';

const router = require('express').Router();

let db = {};
try { db = require('../models'); } catch {}

let authenticateUser = (_req, _res, next) => next();
try { ({ authenticateUser } = require('../middleware/authMiddleware')); } catch {}

router.use(authenticateUser);

// List
router.get('/', async (_req, res, next) => {
  try {
    const items = await db.Permission.findAll({ order: [['action','ASC']] });
    res.json(items.map(p => ({ id: p.id, name: p.action, description: p.description })));
  } catch (e) { next(e); }
});

// Create
router.post('/', async (req, res, next) => {
  try {
    const name = (req.body.name || '').trim();
    if (!name) return res.status(400).json({ error: 'name required' });
    const p = await db.Permission.create({ action: name, roles: [], description: name });
    res.json({ id: p.id, name: p.action, description: p.description });
  } catch (e) { next(e); }
});

// Delete
router.delete('/:id', async (req, res, next) => {
  try {
    await db.Permission.destroy({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;
