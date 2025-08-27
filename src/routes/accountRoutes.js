'use strict';

const express = require('express');
const router = express.Router();
const { authenticateUser } = require('../middleware/authMiddleware');

const {
  getBilling,
  updateBilling,
  changePassword,
} = require('../controllers/account/accountSettingsController');

router.get('/settings/billing', authenticateUser, getBilling);
router.put('/settings/billing', authenticateUser, updateBilling);

router.post('/change-password', authenticateUser, changePassword);

module.exports = router;
