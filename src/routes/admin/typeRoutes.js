'use strict';
const express = require('express');
const router = express.Router();

// Optional: require auth middleware if you want to protect them
const { authenticateUser, requireAuth, authorizeRoles } = require('../../middleware/authMiddleware');
const ADMIN = authorizeRoles('admin', 'director');

// In-memory store; swap to Sequelize later if needed
const mem = new Map(); // key: category, val: [{id, name, code, meta}]

function listFor(cat) {
  if (!mem.has(cat)) mem.set(cat, []);
  return mem.get(cat);
}

router.get('/:category', authenticateUser, requireAuth, (req, res) => {
  const rows = listFor(req.params.category);
  res.setHeader('X-Total-Count', String(rows.length));
  return res.json(rows);
});

router.post('/:category', authenticateUser, ADMIN, (req, res) => {
  const rows = listFor(req.params.category);
  const id = Date.now();
  const { name, code, meta } = req.body || {};
  rows.push({ id, name, code, meta: meta ?? null });
  return res.status(201).json({ id });
});

router.delete('/:category/:id', authenticateUser, ADMIN, (req, res) => {
  const rows = listFor(req.params.category);
  const id = String(req.params.id);
  const idx = rows.findIndex(r => String(r.id) === id);
  if (idx >= 0) rows.splice(idx, 1);
  return res.status(204).end();
});

module.exports = router;
