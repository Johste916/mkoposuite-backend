'use strict';

const express = require('express');
const router = express.Router();
const { authenticateUser } = require('../middleware/authMiddleware');
const ctrl = require('../controllers/disbursementController');

router.post('/batches', authenticateUser, ctrl.createBatch);
router.get('/batches', authenticateUser, ctrl.listBatches);
router.get('/batches/:id/export', authenticateUser, ctrl.exportCSV);

module.exports = router;
module.exports.default = router;
module.exports.router = router;
