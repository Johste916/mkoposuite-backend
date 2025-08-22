'use strict';
const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/collectionSheetsController');

// Base: /api/collections

// List (supports ?page=&limit=&q=&status=&type=&collector=&loanOfficer=&dateFrom=&dateTo=&includeDeleted=true|false&sort=field:dir&export=csv)
router.get('/', ctrl.list);

// Get one by id
router.get('/:id', ctrl.get);

// Create
router.post('/', ctrl.create);

// Update
router.put('/:id', ctrl.update);

// Soft delete (or hard delete if deletedAt not supported)
router.delete('/:id', ctrl.remove);

// Restore soft-deleted (only if deletedAt is supported)
router.post('/:id/restore', ctrl.restore);

module.exports = router;
