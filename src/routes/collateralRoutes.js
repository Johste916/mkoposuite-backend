'use strict';
const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/collateralController');
const { authenticateUser } = require('../middleware/authMiddleware');

// Base: /api/collateral
router.get('/', authenticateUser, ctrl.list);
router.get('/:id', authenticateUser, ctrl.get);
router.post('/', authenticateUser, ctrl.create);
router.put('/:id', authenticateUser, ctrl.update);
router.post('/:id/release', authenticateUser, ctrl.release);
router.delete('/:id', authenticateUser, ctrl.remove);

module.exports = router;
