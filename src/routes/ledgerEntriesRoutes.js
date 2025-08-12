'use strict';
const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/ledgerEntriesController');

// Base: /api/ledger-entries

// List (filters: ?page=&limit=&accountId=&journalEntryId=&from=&to=&q=)
router.get('/', ctrl.list);

// Get one by id
router.get('/:id', ctrl.get);

// Create
router.post('/', ctrl.create);

// Update
router.put('/:id', ctrl.update);

// Delete
router.delete('/:id', ctrl.remove);

module.exports = router;
