const express = require('express');
const router = express.Router();
const { authenticateUser } = require('../middleware/authMiddleware');
const borrowerCtrl = require('../controllers/borrowerController');

// legacy GETs used by BorrowerDetails.jsx
router.get('/loans/borrower/:id', authenticateUser, borrowerCtrl.getLoansByBorrower);
router.get('/repayments/borrower/:id', authenticateUser, borrowerCtrl.getRepaymentsByBorrower);
router.get('/comments/borrower/:id', authenticateUser, borrowerCtrl.listComments);
router.get('/savings/borrower/:id', authenticateUser, borrowerCtrl.getSavingsByBorrower);

// legacy POST /comments with { borrowerId, content }
router.post('/comments', authenticateUser, (req, res, next) => {
  req.params.id = req.body?.borrowerId;
  return borrowerCtrl.addComment(req, res, next);
});

module.exports = router;
