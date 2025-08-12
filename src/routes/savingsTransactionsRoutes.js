'use strict';
const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/savingsTransactionsController');

// Base: /api/savings-transactions

// List (supports ?page=&limit=&q=&accountId=&type=deposit|withdrawal)
router.get('/', ctrl.list);

// Get one by ID
router.get('/:id', ctrl.get);

// Create
router.post('/', ctrl.create);

// Update
router.put('/:id', ctrl.update);

// Delete
router.delete('/:id', ctrl.remove);

module.exports = router;
