'use strict';

const express = require('express');
const router = express.Router();
const { authenticateUser } = require('../middleware/authMiddleware');
const account = require('../controllers/account/accountSettingsController');

// Billing
router.get('/billing', authenticateUser, account.getBilling);
router.put('/billing', authenticateUser, account.updateBilling);

// Change password
router.post('/change-password', authenticateUser, account.changePassword);

module.exports = router;
