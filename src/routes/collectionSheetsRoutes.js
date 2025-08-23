'use strict';
const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/collectionSheetsController');

// Base: /api/collections

// Scopes as dedicated endpoints (frontend can also use ?scope=)
router.get('/daily',        ctrl.listWithScope('daily'));
router.get('/missed',       ctrl.listWithScope('missed'));
router.get('/past-maturity',ctrl.listWithScope('past-maturity'));

// List (supports ?page=&limit=&q=&scope=&pastDays=&status=&type=&dateFrom=&dateTo=&collector=&loanOfficer=)
router.get('/', ctrl.list);

// Get one by id
router.get('/:id', ctrl.get);

// Create
router.post('/', ctrl.create);

// Update
router.put('/:id', ctrl.update);

// Delete
router.delete('/:id', ctrl.remove);

// Optional restore (if your model supports soft delete)
router.post('/:id/restore', ctrl.restore);

module.exports = router;
