const express = require('express');
const router = express.Router();
const repaymentController = require('../controllers/repaymentController');
const { authenticateToken } = require('../middleware/authMiddleware');

router.get('/', authenticateToken, repaymentController.getAllRepayments);
router.get('/borrower/:borrowerId', authenticateToken, repaymentController.getRepaymentsByBorrower);
router.post('/', authenticateToken, repaymentController.createRepayment); // Admin only

module.exports = router;
