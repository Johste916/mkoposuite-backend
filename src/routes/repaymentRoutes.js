// src/routes/repaymentRoutes.js

const express = require('express');
const router = express.Router();

const repaymentController = require('../controllers/repaymentController');
const { authenticateUser } = require('../middleware/authMiddleware');

// =========================
// 📥 LISTING & SEARCH
// =========================

// Get all repayments (supports q, loanId, borrowerId, dateFrom, dateTo, page, pageSize)
router.get('/', authenticateUser, repaymentController.getAllRepayments);

// Get repayments for a specific borrower
router.get('/borrower/:borrowerId', authenticateUser, repaymentController.getRepaymentsByBorrower);

// Get repayments for a specific loan
router.get('/loan/:loanId', authenticateUser, repaymentController.getRepaymentsByLoan);

// Get single repayment by ID (for receipt view)
router.get('/:id', authenticateUser, repaymentController.getRepaymentById);

// =========================
/* 💰 CREATION */
// =========================

// Manual repayment entry (used by ManualRepayment.jsx)
router.post('/manual', authenticateUser, repaymentController.createRepayment);

// =========================
// 🧮 PREVIEW / CALCULATIONS
// =========================

// Preview allocation before posting (used by ManualRepayment.jsx preview)
router.post('/preview-allocation', authenticateUser, repaymentController.previewAllocation);

// =========================
// ✏️ UPDATES / DELETES
// =========================

router.put('/:id', authenticateUser, repaymentController.updateRepayment);
router.delete('/:id', authenticateUser, repaymentController.deleteRepayment);

module.exports = router;
