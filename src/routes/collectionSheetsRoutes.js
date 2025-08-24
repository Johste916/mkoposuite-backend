'use strict';
const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/collectionSheetsController');
const { authenticateUser } = require('../middleware/authMiddleware');

// minimal guards
const allowRolesRead  = new Set(['admin','director','branch_manager','compliance','staff']);
const allowRolesWrite = new Set(['admin','director','branch_manager']);
const allowRolesComms = new Set(['admin','director','branch_manager','comms']);

const hasPerm = (u, p) => Array.isArray(u?.permissions) && u.permissions.includes(p);
const hasRole = (u, set) => u?.role && set.has(u.role);

const canRead  = (req,res,next)=> (hasRole(req.user,allowRolesRead)  || hasPerm(req.user,'collections.read'))  ? next() : next(Object.assign(new Error('Forbidden'),{status:403,expose:true}));
const canWrite = (req,res,next)=> (hasRole(req.user,allowRolesWrite) || hasPerm(req.user,'collections.write')) ? next() : next(Object.assign(new Error('Forbidden'),{status:403,expose:true}));
const canComms = (req,res,next)=> (hasRole(req.user,allowRolesComms) || hasPerm(req.user,'comms.sms'))         ? next() : next(Object.assign(new Error('Forbidden'),{status:403,expose:true}));

// Scoped lists
router.get('/daily',         authenticateUser, canRead,  ctrl.listWithScope('daily'));
router.get('/missed',        authenticateUser, canRead,  ctrl.listWithScope('missed'));
router.get('/past-maturity', authenticateUser, canRead,  ctrl.listWithScope('past-maturity'));

// Main
router.get('/',              authenticateUser, canRead,  ctrl.list);
router.get('/:id',           authenticateUser, canRead,  ctrl.get);

// Mutations
router.post('/',             authenticateUser, canWrite, ctrl.create);
router.put('/:id',           authenticateUser, canWrite, ctrl.update);
router.delete('/:id',        authenticateUser, canWrite, ctrl.remove);
router.post('/:id/restore',  authenticateUser, canWrite, ctrl.restore);
router.post('/:id/status',   authenticateUser, canWrite, ctrl.changeStatus);

// Bulk SMS
router.post('/bulk-sms',     authenticateUser, canComms, ctrl.bulkSms);

module.exports = router;
