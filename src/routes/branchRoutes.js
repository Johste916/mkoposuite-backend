// backend/src/routes/branchRoutes.js
'use strict';
const express = require('express');
const router = express.Router();

let db = {};
try { db = require('../models'); } catch {}
const { Op } = require('sequelize');

const controller = (() => {
  try { return require('../controllers/branchController'); }
  catch { return null; }
})();

const requireAuth = (req, res, next) => (req.user ? next() : res.status(401).json({ error: 'Unauthorized' }));
const allow = (() => { try { return require('../middleware/permissions').allow; } catch { return null; } })();
const maybe = (perm) => (allow ? allow(perm) : (_req, _res, next) => next());

/* -------- CRUD -------- */
router.get('/',       requireAuth, maybe('branches:view'),  controller.list);
router.post('/',      requireAuth, maybe('branches:manage'), controller.create);
router.get('/:id',    requireAuth, maybe('branches:view'),  controller.getOne);
router.patch('/:id',  requireAuth, maybe('branches:manage'), controller.update);
router.delete('/:id', requireAuth, maybe('branches:manage'), controller.remove);

/* -------- Staff assignment -------- */
router.get('/:id/staff',         requireAuth, maybe('branches:view'),   controller.listStaff);
router.post('/:id/assign-staff', requireAuth, maybe('branches:assign'), controller.assignStaff);
router.delete('/:id/staff/:userId', requireAuth, maybe('branches:assign'), controller.unassignStaff);

module.exports = router;
