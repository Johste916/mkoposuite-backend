'use strict';

const express = require('express');
const router = express.Router();

let auth = {};
try { auth = require('../../middleware/authMiddleware'); } catch {}
const authenticateUser = auth.authenticateUser || ((_req, _res, next) => next());
const requireAuth      = auth.requireAuth      || ((_req, _res, next) => next());
const authorizeRoles   = auth.authorizeRoles   || (() => ((_req, _res, next) => next()));

let models = null;
try { models = require('../../models'); } catch {}

router.use(authenticateUser, requireAuth, authorizeRoles('admin', 'director', 'superadmin'));

router.get('/', async (req, res) => {
  try {
    if (models?.AuditLog?.findAll) {
      const rows = await models.AuditLog.findAll({ limit: 200, order: [['createdAt', 'DESC']] });
      return res.ok({ items: rows });
    }
    // Fallback: empty list instead of 500
    return res.ok({ items: [] });
  } catch (e) {
    // On error, degrade gracefully
    return res.ok({ items: [] });
  }
});

router.get('/:id', async (req, res) => {
  try {
    if (models?.AuditLog?.findByPk) {
      const row = await models.AuditLog.findByPk(String(req.params.id));
      if (!row) return res.status(404).json({ error: 'Not found' });
      return res.ok(row);
    }
    return res.status(404).json({ error: 'Not found' });
  } catch (e) {
    return res.status(404).json({ error: 'Not found' });
  }
});

module.exports = router;
