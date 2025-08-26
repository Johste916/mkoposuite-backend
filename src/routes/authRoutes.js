'use strict';

const express = require('express');
const router = express.Router();
const { authenticateUser } = require('../middleware/authMiddleware');

// your existing login may already be wired here
const authController = require('../controllers/authController');

// 2FA controller
const twoFA = require('../controllers/auth2faController');

// Login (keep your existing path)
router.post('/login', authController.login);

// 2FA endpoints
router.get('/2fa/status', authenticateUser, twoFA.status);
router.post('/2fa/setup', authenticateUser, twoFA.setup);
router.post('/2fa/verify', authenticateUser, twoFA.verify);
router.post('/2fa/disable', authenticateUser, twoFA.disable);

module.exports = router;
