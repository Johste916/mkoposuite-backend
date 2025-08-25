'use strict';
const express = require('express');
const router = express.Router();
const { authenticateUser } = require('../middleware/authMiddleware');
const ctrl = require('../controllers/tenantsController');

// Base: /api/tenants
router.get('/me', authenticateUser, ctrl.me);
router.get('/me/entitlements', authenticateUser, ctrl.entitlements);

module.exports = router;
