'use strict';

const express = require('express');
const router = express.Router();
const { authenticateUser } = require('../middleware/authMiddleware');

const billing = require('../controllers/account/billingController');

// /api/account/settings/billing
router.get('/settings/billing', authenticateUser, billing.getBilling);
router.put('/settings/billing', authenticateUser, billing.updateBilling);

module.exports = router;
