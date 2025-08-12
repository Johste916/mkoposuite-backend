'use strict';
const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/investorsController');

// Base: /api/investors

// List (supports ?page=&limit=&q=)
router.get('/', ctrl.list);

// Get one by ID
router.get('/:id', ctrl.get);

// Create new
router.post('/', ctrl.create);

// Update by ID
router.put('/:id', ctrl.update);

// Delete by ID
router.delete('/:id', ctrl.remove);

module.exports = router;
