'use strict';

const express = require('express');
const router = express.Router();
const { authenticateUser } = require('../middleware/authMiddleware');

const twoFA = require('../controllers/auth/twoFactorController');

// 2FA status/setup/verify/disable
router.get('/2fa/status', authenticateUser, twoFA.status);
router.post('/2fa/setup', authenticateUser, twoFA.setup);
router.post('/2fa/verify', authenticateUser, twoFA.verify);
router.post('/2fa/disable', authenticateUser, twoFA.disable);

module.exports = router;
