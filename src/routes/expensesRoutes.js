'use strict';
const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/expensesController');

// Base: /api/expenses

// List (supports ?page=&limit=&q=)
router.get('/', ctrl.list);

// Get by ID
router.get('/:id', ctrl.get);

// Create
router.post('/', ctrl.create);

// Update
router.put('/:id', ctrl.update);

// Delete
router.delete('/:id', ctrl.remove);

module.exports = router;
