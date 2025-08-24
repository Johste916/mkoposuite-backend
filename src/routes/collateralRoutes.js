'use strict';
const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/collateralController');
const { authenticateUser } = require('../middleware/authMiddleware');

// basic guard (adjust to your ACL)
const allowRolesRead  = new Set(['admin','director','branch_manager','staff']);
const allowRolesWrite = new Set(['admin','director','branch_manager']);

const hasPerm = (u, p) => Array.isArray(u?.permissions) && u.permissions.includes(p);
const hasRole = (u, s) => u?.role && s.has(u.role);

const canRead  = (req,res,next)=> (hasRole(req.user,allowRolesRead)  || hasPerm(req.user,'collateral.read'))  ? next() : next(Object.assign(new Error('Forbidden'),{status:403,expose:true}));
const canWrite = (req,res,next)=> (hasRole(req.user,allowRolesWrite) || hasPerm(req.user,'collateral.write')) ? next() : next(Object.assign(new Error('Forbidden'),{status:403,expose:true}));

// List + read
router.get('/',          authenticateUser, canRead,  ctrl.list);
router.get('/:id',       authenticateUser, canRead,  ctrl.get);

// Create / Update / Delete / Release
router.post('/',         authenticateUser, canWrite, ctrl.create);
router.put('/:id',       authenticateUser, canWrite, ctrl.update);
router.delete('/:id',    authenticateUser, canWrite, ctrl.remove);   // exists now
router.post('/:id/release', authenticateUser, canWrite, ctrl.release);

// Helpers for the form
router.get('/helpers/borrower-search', authenticateUser, canRead, ctrl.searchBorrowers);
router.get('/helpers/open-loans',      authenticateUser, canRead, ctrl.getOpenLoans);

module.exports = router;
