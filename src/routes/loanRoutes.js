// backend/src/routes/loanRoutes.js

const express = require('express');
const router = express.Router();
const loanCtrl = require('../controllers/loanController');
const authenticateToken = require('../middleware/authMiddleware');
const authorize = require('../middleware/roleMiddleware');

// ─── LOAN CRUD ────────────────────────────────────────────

// Create a new loan (any authenticated user)
router.post(
  '/',
  authenticateToken,
  authorize(), // any logged-in user
  loanCtrl.createLoan
);

// List all loans
router.get(
  '/',
  authenticateToken,
  authorize(),
  loanCtrl.getLoans // FIXED: matches controller definition
);

// Get one loan by ID
router.get(
  '/:id',
  authenticateToken,
  authorize(),
  loanCtrl.getLoanById
);

// Update a loan
router.put(
  '/:id',
  authenticateToken,
  authorize(['loan_officer', 'manager', 'admin']),
  loanCtrl.updateLoan
);

// Delete a loan
router.delete(
  '/:id',
  authenticateToken,
  authorize('admin'),
  loanCtrl.deleteLoan
);

// Disburse a loan
router.patch(
  '/:id/disburse',
  authenticateToken,
  authorize(['manager', 'admin']),
  loanCtrl.disburseLoan // ✅ Make sure this exists in loanController.js
);

module.exports = router;
