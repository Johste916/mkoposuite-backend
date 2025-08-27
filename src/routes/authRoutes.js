'use strict';

const express = require('express');
const router = express.Router();
const { authenticateUser } = require('../middleware/authMiddleware');

const {
  login,
  getTwoFAStatus,
  setupTwoFA,
  verifyTwoFA,
  disableTwoFA,
} = require('../controllers/authController');

// Works for both mounts: /api/login and /api/auth/login
router.post('/', login);
router.post('/login', login);

// 2FA (requires auth)
router.get('/2fa/status', authenticateUser, getTwoFAStatus);
router.post('/2fa/setup', authenticateUser, setupTwoFA);
router.post('/2fa/verify', authenticateUser, verifyTwoFA);
router.post('/2fa/disable', authenticateUser, disableTwoFA);

module.exports = router;
