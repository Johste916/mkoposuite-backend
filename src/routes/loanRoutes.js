const express = require('express');
const router = express.Router();
const loanController = require('../controllers/loanController');
const { authenticateUser } = require('../middleware/authMiddleware');

router.post('/', authenticateUser, loanController.createLoan);
router.get('/', authenticateUser, loanController.getAllLoans);
router.get('/:id', authenticateUser, loanController.getLoanById);
router.put('/:id', authenticateUser, loanController.updateLoan);
router.delete('/:id', authenticateUser, loanController.deleteLoan);

router.post('/:id/approve', authenticateUser, loanController.approveLoan);
router.post('/:id/reject', authenticateUser, loanController.rejectLoan);
router.post('/:id/disburse', authenticateUser, loanController.disburseLoan);

router.get('/:loanId/schedule', authenticateUser, loanController.getLoanSchedule);
router.get('/disbursements/list', authenticateUser, loanController.getDisbursementList);

module.exports = router;
