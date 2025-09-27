'use strict';

const express = require('express');
const router = express.Router();
const multer = require('multer');

const upload = multer(); // in case UI posts form-data

const disbursementController = require('../controllers/loanDisbursementController');
const { authenticateUser, authorizeRoles } = require('../middleware/authMiddleware');

/** Safe wrapper */
const h = (name) => (req, res, next) => {
  if (disbursementController && typeof disbursementController[name] === 'function') {
    return disbursementController[name](req, res, next);
  }
  return res.status(501).json({ error: `Controller method ${name} is not implemented` });
};

// 🟡 Step 1: Loan Officer initiates disbursement
router.post(
  '/initiate',
  authenticateUser,
  authorizeRoles('Loan Officer', 'Admin'),
  upload.any(),
  h('initiateDisbursement')
);

// 🔵 Step 2: Manager or Director approves the disbursement
router.post(
  '/approve',
  authenticateUser,
  authorizeRoles('Manager', 'Director', 'Admin'),
  upload.any(),
  h('approveDisbursement')
);

// 🟢 Step 3: Accountant disburses the loan
router.post(
  '/finalize',
  authenticateUser,
  authorizeRoles('Accountant', 'Admin'),
  upload.any(),
  h('finalizeDisbursement')
);

// 🔴 Optional: Reject request
router.post(
  '/reject',
  authenticateUser,
  authorizeRoles('Manager', 'Director', 'Admin'),
  upload.any(),
  h('rejectDisbursement')
);

// 📋 View all disbursement requests (Admin or Manager)
router.get(
  '/',
  authenticateUser,
  authorizeRoles('Admin', 'Manager', 'Director'),
  h('getDisbursementRequests')
);

module.exports = router;
module.exports.default = router;
module.exports.router = router;
