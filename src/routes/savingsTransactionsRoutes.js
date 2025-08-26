'use strict';
const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/savingsTransactionsController');

// List / filter
router.get('/', ctrl.list);

// Staff report
router.get('/staff-report', ctrl.staffReport);

// Bulk import
router.post('/bulk', ctrl.bulkCreate);

// CRUD
router.get('/:id', ctrl.get);
router.post('/', ctrl.create);
router.put('/:id', ctrl.update);
router.patch('/:id/reverse', ctrl.reverse);

// Approvals
router.patch('/:id/approve', ctrl.approve);
router.patch('/:id/reject', ctrl.reject);

// Delete
router.delete('/:id', ctrl.remove);

module.exports = router;
