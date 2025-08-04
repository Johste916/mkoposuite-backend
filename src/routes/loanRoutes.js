// src/routes/loanRoutes.js

const express = require('express');
const router = express.Router();
const loanController = require('../controllers/loanController');
const { authenticateToken } = require('../middleware/authMiddleware');

// 📄 Create a new loan
router.post('/', authenticateToken, loanController.createLoan);

// 📄 Get all loans
router.get('/', authenticateToken, loanController.getAllLoans);

// 📄 Get loan by ID
router.get('/:id', authenticateToken, loanController.getLoanById);

// ✏️ Update a loan
router.put('/:id', authenticateToken, loanController.updateLoan);

// ❌ Delete a loan
router.delete('/:id', authenticateToken, loanController.deleteLoan);

// ✅ Approve a loan
router.post('/:id/approve', authenticateToken, loanController.approveLoan);

// ❌ Reject a loan
router.post('/:id/reject', authenticateToken, loanController.rejectLoan);

// 💵 Disburse a loan
router.post('/:id/disburse', authenticateToken, loanController.disburseLoan);

// 📆 Get amortization schedule
router.get('/:loanId/schedule', authenticateToken, loanController.getLoanSchedule);

// 📄 Get disbursement list
router.get('/disbursements/list', authenticateToken, loanController.getDisbursementList);

module.exports = router;
