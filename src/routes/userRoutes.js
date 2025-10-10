'use strict';

const express = require('express');
const router = express.Router();

let db = {};
try { db = require('../models'); } catch {}
const { Op } = require('sequelize');

let authenticateUser = (_req, _res, next) => next();
try { ({ authenticateUser } = require('../middleware/authMiddleware')); } catch {}

let userCtrl = {};
try { userCtrl = require('../controllers/userController'); } catch {}

/** Resolve a model or throw a clear 500 the app can log */
const getModel = (name) => {
  const m = db?.[name] || db?.sequelize?.models?.[name];
  if (!m) {
    throw Object.assign(new Error(`Model "${name}" not found`), { status: 500, expose: true });
  }
  return m;
};

router.use(authenticateUser);

/* -------- LIST (fallbacks to inline list if controller not present) -------- */
router.get('/', async (req, res, next) => {
  if (typeof userCtrl.getUsers === 'function') {
    return userCtrl.getUsers(req, res, next);
  }
  try {
    const User = getModel('User');
    const Role = getModel('Role');

    const where = {};
    const q = (req.query.q || '').trim();
    const like = User.sequelize.getDialect() === 'postgres' ? Op.iLike : Op.like;

    if (q) {
      where[Op.or] = [
        { name:      { [like]: `%${q}%` } },
        { email:     { [like]: `%${q}%` } },
        { firstName: { [like]: `%${q}%` } },
        { lastName:  { [like]: `%${q}%` } },
      ];
    }
    if (req.query.branchId) where.branchId = req.query.branchId;

    // Always include roles so FE can filter locally as well
    const include = [{ model: Role, as: 'Roles', through: { attributes: [] } }];
    const limit = Math.min(Number(req.query.limit) || 1000, 2000);

    const rows = await (User.findAll({
      where,
      include,
      order: [['name', 'ASC']],
      limit,
    }));

    // Optional filter by role name (case-insensitive)
    const roleFilter = (req.query.role || req.query.roleName || req.query.roles || '').toLowerCase();
    const items = roleFilter
      ? rows.filter(u =>
          (u.Roles || []).some(r => (String(r.name) || '').toLowerCase() === roleFilter) ||
          (String(u.role) || '').toLowerCase() === roleFilter
        )
      : rows;

    res.json({ items });
  } catch (e) { next(e); }
});

/* -------- CRUD passthroughs to controller -------- */
router.get('/:id',                (req, res, next) => typeof userCtrl.getUserById   === 'function' ? userCtrl.getUserById(req, res, next)   : res.status(501).json({ error: 'getUserById not implemented' }));
router.post('/',                  (req, res, next) => typeof userCtrl.createUser    === 'function' ? userCtrl.createUser(req, res, next)    : res.status(501).json({ error: 'createUser not implemented' }));
router.put('/:id',                (req, res, next) => typeof userCtrl.updateUser    === 'function' ? userCtrl.updateUser(req, res, next)    : res.status(501).json({ error: 'updateUser not implemented' }));
router.patch('/:id/password',     (req, res, next) => typeof userCtrl.resetPassword === 'function' ? userCtrl.resetPassword(req, res, next) : res.status(501).json({ error: 'resetPassword not implemented' }));
router.patch('/:id/status',       (req, res, next) => typeof userCtrl.toggleStatus  === 'function' ? userCtrl.toggleStatus(req, res, next)  : res.status(501).json({ error: 'toggleStatus not implemented' }));

/* -------- Assignment & Delete (support PUT and POST for assign) -------- */
router.put('/:id/assign',         (req, res, next) => typeof userCtrl.assignRoles === 'function' ? userCtrl.assignRoles(req, res, next) : res.status(501).json({ error: 'assignRoles not implemented' }));
router.post('/:id/assign',        (req, res, next) => typeof userCtrl.assignRoles === 'function' ? userCtrl.assignRoles(req, res, next) : res.status(501).json({ error: 'assignRoles not implemented' }));
router.delete('/:id',             (req, res, next) => typeof userCtrl.deleteUser  === 'function' ? userCtrl.deleteUser(req, res, next)  : res.status(501).json({ error: 'deleteUser not implemented' }));

module.exports = router;
