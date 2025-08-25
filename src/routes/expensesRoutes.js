'use strict';
const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/expensesController');
const { authenticateUser } = require('../middleware/authMiddleware');

/** Simple role/permission guards (adjust to your ACL) */
const allowRead  = new Set(['admin','director','accountant','branch_manager','staff']);
const allowWrite = new Set(['admin','director','accountant','branch_manager']);

const hasPerm = (u, p) => Array.isArray(u?.permissions) && u.permissions.includes(p);
const hasRole = (u, set) => u?.role && set.has(String(u.role).toLowerCase());

const canRead  = (req, _res, next) => (hasRole(req.user, allowRead)  || hasPerm(req.user, 'expenses.read'))  ? next() : next(Object.assign(new Error('Forbidden'), { status: 403, expose: true }));
const canWrite = (req, _res, next) => (hasRole(req.user, allowWrite) || hasPerm(req.user, 'expenses.write')) ? next() : next(Object.assign(new Error('Forbidden'), { status: 403, expose: true }));

// Base: /api/expenses
router.get('/',      authenticateUser, canRead,  ctrl.list);
router.get('/:id',   authenticateUser, canRead,  ctrl.get);
router.post('/',     authenticateUser, canWrite, ctrl.create);
router.put('/:id',   authenticateUser, canWrite, ctrl.update);
router.delete('/:id',authenticateUser, canWrite, ctrl.remove);

module.exports = router;
