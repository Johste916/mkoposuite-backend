// routes/loanDisbursementRoutes.js
const express = require('express');
const router = express.Router();
const disbursementController = require('../controllers/loanDisbursementController');
const { authenticateUser, authorizeRoles } = require('../middleware/authMiddleware');

// 🟡 Step 1: Loan Officer initiates disbursement (must be authenticated)
router.post(
  '/initiate',
  authenticateUser,
  authorizeRoles('Loan Officer', 'Admin'),
  disbursementController.initiateDisbursement
);

// 🔵 Step 2: Manager or Director approves the disbursement
router.post(
  '/approve',
  authenticateUser,
  authorizeRoles('Manager', 'Director', 'Admin'),
  disbursementController.approveDisbursement
);

// 🟢 Step 3: Accountant disburses the loan
router.post(
  '/finalize',
  authenticateUser,
  authorizeRoles('Accountant', 'Admin'),
  disbursementController.finalizeDisbursement
);

// 🔴 Optional: Reject request
router.post(
  '/reject',
  authenticateUser,
  authorizeRoles('Manager', 'Director', 'Admin'),
  disbursementController.rejectDisbursement
);

// 📋 View all disbursement requests (Admin or Manager)
router.get(
  '/',
  authenticateUser,
  authorizeRoles('Admin', 'Manager', 'Director'),
  disbursementController.getDisbursementRequests
);

module.exports = router;
