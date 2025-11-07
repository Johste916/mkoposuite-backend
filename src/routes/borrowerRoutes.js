// routes/borrowers.js
"use strict";

const express = require('express');
const router = express.Router();
const { authenticateUser } = require('../middleware/authMiddleware');
const ctrl = require('../controllers/borrowerController');
const borrowerReportsCtrl = require('../controllers/borrowerReportsController');
const groupReportsCtrl = require('../controllers/groupReportsController');

let multer;
try { multer = require('multer'); } catch {}
const hasMulter = !!multer;
const upload = hasMulter ? multer({ storage: multer.memoryStorage() }) : null;

const requireMulterAny = hasMulter
  ? upload.any()
  : (_req, res) => res.status(501).json({ error: 'File upload not enabled.' });

const requireMulterSingleFile = hasMulter
  ? upload.single('file')
  : (_req, res) => res.status(501).json({ error: 'File upload not enabled.' });

/* ---------------- Try load the new Groups controller (optional) ----------- */
let groupCtrl = null;
try {
  const models = require('../models');
  const build = require('../controllers/borrowerGroupController');
  groupCtrl = build && typeof build === 'function' ? build({ models }) : null;
} catch { /* keep null to fallback to ctrl.* */ }

/* ---------------- Reports BEFORE :id routes ---------------- */
router.get('/reports/summary',           authenticateUser, borrowerReportsCtrl.getBorrowerSummary);
router.get('/groups/reports/summary',    authenticateUser, groupReportsCtrl.getGroupSummary);
router.get('/reports',                   authenticateUser, ctrl.globalBorrowerReport);

/* ---------------- Groups ---------------- */
router.get('/groups',                    authenticateUser, (req, res, next) =>
  groupCtrl ? groupCtrl.list(req, res, next) : ctrl.listGroups(req, res, next)
);
router.post('/groups',                   authenticateUser, (req, res, next) =>
  groupCtrl ? groupCtrl.create(req, res, next) : ctrl.createGroup(req, res, next)
);
router.get('/groups/:groupId',           authenticateUser, (req, res, next) =>
  groupCtrl ? groupCtrl.getOne(req, res, next) : ctrl.getGroup(req, res, next)
);
router.put('/groups/:groupId',           authenticateUser, ctrl.updateGroup);
router.post('/groups/:groupId/members',  authenticateUser, (req, res, next) =>
  groupCtrl ? groupCtrl.addMember(req, res, next) : ctrl.addGroupMember(req, res, next)
);
router.delete('/groups/:groupId/members/:borrowerId', authenticateUser, (req, res, next) =>
  groupCtrl ? groupCtrl.removeMember(req, res, next) : ctrl.removeGroupMember(req, res, next)
);
router.get('/groups/reports',            authenticateUser, ctrl.groupReports);
router.post('/groups/:groupId/import',   authenticateUser, requireMulterSingleFile, ctrl.importGroupMembers);

/* ---------------- Lists that might conflict with :id — keep BEFORE -------- */
router.get('/blacklist/list',            authenticateUser, ctrl.listBlacklisted);
router.get('/kyc/queue',                 authenticateUser, ctrl.listKycQueue);

/* ---------------- Borrowers CRUD ---------------- */
router.get('/',                          authenticateUser, ctrl.getAllBorrowers);

/**
 * Frontend sends multipart/form-data (optional photo). We must parse it.
 * Using upload.any() keeps backward compatibility if no files are sent.
 */
router.post('/',                         authenticateUser, requireMulterAny, ctrl.createBorrower);

router.put('/:id',                       authenticateUser, ctrl.updateBorrower);
router.patch('/:id',                     authenticateUser, ctrl.updateBorrower);
router.post('/:id/disable',              authenticateUser, ctrl.disableBorrower);
router.delete('/:id',                    authenticateUser, ctrl.deleteBorrower);

// Explicit branch assign/unassign
router.post('/:id/branch',               authenticateUser, ctrl.assignBranch);
router.delete('/:id/branch',             authenticateUser, ctrl.unassignBranch);

// Nested
router.get('/:id/loans',                 authenticateUser, ctrl.getLoansByBorrower);
router.get('/:id/repayments',            authenticateUser, ctrl.getRepaymentsByBorrower);

// Comments
router.get('/:id/comments',              authenticateUser, ctrl.listComments);
router.post('/:id/comments',             authenticateUser, ctrl.addComment);

// Savings
router.get('/:id/savings',               authenticateUser, ctrl.getSavingsByBorrower);

// Blacklist
router.post('/:id/blacklist',            authenticateUser, ctrl.blacklist);
router.delete('/:id/blacklist',          authenticateUser, ctrl.unblacklist);

// KYC
router.post('/:id/kyc',                  authenticateUser, requireMulterAny, ctrl.uploadKyc);
router.get('/:id/kyc',                   authenticateUser, ctrl.listKyc);

// Per borrower summary & single
router.get('/:id/report/summary',        authenticateUser, ctrl.summaryReport);
router.get('/:id',                       authenticateUser, ctrl.getBorrowerById);

module.exports = router;
