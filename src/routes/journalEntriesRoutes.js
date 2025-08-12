'use strict';
const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/journalEntriesController');

// Base path: /api/journal-entries
router.get('/', ctrl.list);
router.get('/:id', ctrl.get);
router.post('/', ctrl.create);
router.put('/:id', ctrl.update);
router.delete('/:id', ctrl.remove);

module.exports = router;
