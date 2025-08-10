// src/routes/borrowerRoutes.js
const express = require('express');
const router = express.Router();
const { authenticateUser } = require('../middleware/authMiddleware');
const ctrl = require('../controllers/borrowerController');

// ---------- Optional file uploads (multer) ----------
let multer;
try { multer = require('multer'); } catch {}
const hasMulter = !!multer;
const upload = hasMulter ? multer({ storage: multer.memoryStorage() }) : null;

// Helpers to avoid undefined middleware
const requireMulterAny = hasMulter
  ? upload.any()
  : (req, res) => res.status(501).json({ error: 'File upload not enabled. Install "multer".' });

const requireMulterSingleFile = hasMulter
  ? upload.single('file')
  : (req, res) => res.status(501).json({ error: 'File upload not enabled. Install "multer".' });

// ======================================================
// Borrowers CRUD
// ======================================================
router.get('/', authenticateUser, ctrl.getAllBorrowers);
router.post('/', authenticateUser, ctrl.createBorrower);
router.get('/:id', authenticateUser, ctrl.getBorrowerById);
router.put('/:id', authenticateUser, ctrl.updateBorrower);
router.delete('/:id', authenticateUser, ctrl.deleteBorrower);

// ======================================================
// Nested resources (compat with your frontend)
// ======================================================
router.get('/:id/loans', authenticateUser, ctrl.getLoansByBorrower);
router.get('/:id/repayments', authenticateUser, ctrl.getRepaymentsByBorrower);

// Comments
router.get('/:id/comments', authenticateUser, ctrl.listComments);
router.post('/:id/comments', authenticateUser, ctrl.addComment);

// Savings snapshot
router.get('/:id/savings', authenticateUser, ctrl.getSavingsByBorrower);

// ======================================================
// Blacklist
// ======================================================
router.post('/:id/blacklist', authenticateUser, ctrl.blacklist);
router.delete('/:id/blacklist', authenticateUser, ctrl.unblacklist);

// ======================================================
// KYC (file uploads)
// ======================================================
router.post('/:id/kyc', authenticateUser, requireMulterAny, ctrl.uploadKyc);
router.get('/:id/kyc', authenticateUser, ctrl.listKyc);

// ======================================================
// Groups
// ======================================================
router.get('/groups', authenticateUser, ctrl.listGroups);
router.post('/groups', authenticateUser, ctrl.createGroup);
router.get('/groups/:groupId', authenticateUser, ctrl.getGroup);
router.put('/groups/:groupId', authenticateUser, ctrl.updateGroup);
router.post('/groups/:groupId/members', authenticateUser, ctrl.addGroupMember);
router.delete('/groups/:groupId/members/:borrowerId', authenticateUser, ctrl.removeGroupMember);

// ======================================================
// Import (CSV/XLSX) — uses single('file')
// ======================================================
router.post('/import', authenticateUser, requireMulterSingleFile, ctrl.importBorrowers);

// ======================================================
/* Per-borrower quick report */
// ======================================================
router.get('/:id/report/summary', authenticateUser, ctrl.summaryReport);

module.exports = router;
