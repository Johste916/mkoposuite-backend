'use strict';

const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/savingsTransactionsController');

// Base: /api/savings/transactions  (also mounted at /api/savings-transactions)

// List (supports ?page=&limit=&q=&accountId=&type=deposit|withdrawal)
router.get('/', ctrl.list);

// Get one by ID
router.get('/:id', ctrl.get);

// Create
router.post('/', ctrl.create);

// Update
router.put('/:id', ctrl.update);

// Reverse (mark as reversed = true)
router.patch('/:id/reverse', ctrl.reverse);

// Delete
router.delete('/:id', ctrl.remove);

module.exports = router;
