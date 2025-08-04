const express = require('express');
const router = express.Router();
const savingsController = require('../controllers/savingsController');

// Create deposit/withdrawal
router.post('/', savingsController.createTransaction);

// Get savings transactions by borrower
router.get('/borrower/:borrowerId', savingsController.getSavingsByBorrower);

module.exports = router;
