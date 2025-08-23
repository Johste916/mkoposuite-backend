'use strict';
const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/collectionSheetsController');
const { authenticateUser } = require('../middleware/authMiddleware');

/**
 * Minimal permission guard:
 * - If your authMiddleware puts `req.user = { role, permissions: [] }`,
 *   this will check either a matching role OR a named permission.
 * - Adjust roles/permission names to your actual ACL.
 */
const allowRolesRead  = new Set(['admin','director','branch_manager','compliance','staff']);
const allowRolesWrite = new Set(['admin','director','branch_manager']);
const allowRolesComms = new Set(['admin','director','branch_manager','comms']);

const hasPerm = (user, perm) => Array.isArray(user?.permissions) && user.permissions.includes(perm);
const hasRole = (user, rolesSet) => user?.role && rolesSet.has(user.role);

const canRead  = (req, _res, next) => (hasRole(req.user, allowRolesRead)  || hasPerm(req.user, 'collections.read'))  ? next() : next(Object.assign(new Error('Forbidden'), { status: 403, expose: true }));
const canWrite = (req, _res, next) => (hasRole(req.user, allowRolesWrite) || hasPerm(req.user, 'collections.write')) ? next() : next(Object.assign(new Error('Forbidden'), { status: 403, expose: true }));
const canComms = (req, _res, next) => (hasRole(req.user, allowRolesComms) || hasPerm(req.user, 'comms.sms'))         ? next() : next(Object.assign(new Error('Forbidden'), { status: 403, expose: true }));

// Base: /api/collections

// Scoped lists
router.get('/daily',          authenticateUser, canRead, ctrl.listWithScope('daily'));
router.get('/missed',         authenticateUser, canRead, ctrl.listWithScope('missed'));
router.get('/past-maturity',  authenticateUser, canRead, ctrl.listWithScope('past-maturity'));

// Main listing (supports ?scope=&pastDays=&withSummary=1 + filters)
router.get('/',               authenticateUser, canRead, ctrl.list);

// One sheet
router.get('/:id',            authenticateUser, canRead, ctrl.get);

// Create / Update / Delete (UI will show only when allowed; server enforces)
router.post('/',              authenticateUser, canWrite, ctrl.create);
router.put('/:id',            authenticateUser, canWrite, ctrl.update);
router.delete('/:id',         authenticateUser, canWrite, ctrl.remove);
router.post('/:id/restore',   authenticateUser, canWrite, ctrl.restore);

// Bulk SMS (collectors/loan officers/custom phones)
router.post('/bulk-sms',      authenticateUser, canComms, ctrl.bulkSms);

module.exports = router;
