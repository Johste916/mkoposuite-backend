// routes/repayments.js
const express = require('express');
const router = express.Router();
const repaymentController = require('../controllers/repaymentController');
const { authenticateUser } = require('../middleware/authMiddleware');

// =========================
// 📥 LISTING & SEARCH
// =========================
router.get('/', authenticateUser, repaymentController.getAllRepayments);
router.get('/borrower/:borrowerId', authenticateUser, repaymentController.getRepaymentsByBorrower);
router.get('/loan/:loanId', authenticateUser, repaymentController.getRepaymentsByLoan);
router.get('/:id', authenticateUser, repaymentController.getRepaymentById);

// =========================
// 💰 CREATION
// =========================
router.post('/manual', authenticateUser, repaymentController.createRepayment);

// =========================
// 🧮 PREVIEW / CALCULATIONS
// =========================
router.post('/preview-allocation', authenticateUser, repaymentController.previewAllocation);

// =========================
// ✏️ UPDATES / DELETES
// =========================
router.put('/:id', authenticateUser, repaymentController.updateRepayment);
router.delete('/:id', authenticateUser, repaymentController.deleteRepayment);

module.exports = router;
