const express = require('express');
const router = express.Router();
const loanController = require('../controllers/loanController');

// Create a new loan
router.post('/', loanController.createLoan);

// Get all loans
router.get('/', loanController.getAllLoans);

// Get a single loan
router.get('/:id', loanController.getLoanById);

// Update a loan
router.put('/:id', loanController.updateLoan);

// Delete a loan
router.delete('/:id', loanController.deleteLoan);

module.exports = router;
