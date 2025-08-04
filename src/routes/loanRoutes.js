const express = require('express');
const router = express.Router();
const loanController = require('../controllers/loanController');
const { authenticateToken } = require('../middleware/authMiddleware');

// Static routes (must go first)
router.get('/disbursements/list', authenticateToken, loanController.getDisbursementList);
router.get('/:loanId/schedule', authenticateToken, loanController.getLoanSchedule);

// Main routes
router.post('/', authenticateToken, loanController.createLoan);
router.get('/', authenticateToken, loanController.getAllLoans);

// Dynamic routes
router.get('/:id', authenticateToken, loanController.getLoanById);
router.put('/:id', authenticateToken, loanController.updateLoan);
router.delete('/:id', authenticateToken, loanController.deleteLoan);
router.post('/:id/approve', authenticateToken, loanController.approveLoan);
router.post('/:id/reject', authenticateToken, loanController.rejectLoan);
router.post('/:id/disburse', authenticateToken, loanController.disburseLoan);

module.exports = router;
