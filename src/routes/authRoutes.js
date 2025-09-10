'use strict';
const express = require('express');
const router = express.Router();

const { authenticateUser, requireAuth, me } = require('../middleware/authMiddleware');
const { login, getTwoFAStatus, setupTwoFA, verifyTwoFA, disableTwoFA } = require('../controllers/authController');

router.post('/', login);          // /api/login
router.post('/login', login);     // /api/auth/login

router.get('/me', authenticateUser, requireAuth, me);
router.get('/whoami', authenticateUser, requireAuth, me);

router.get('/2fa/status',  authenticateUser, requireAuth, getTwoFAStatus);
router.post('/2fa/setup',  authenticateUser, requireAuth, setupTwoFA);
router.post('/2fa/verify', authenticateUser, requireAuth, verifyTwoFA);
router.post('/2fa/disable',authenticateUser, requireAuth, disableTwoFA);

module.exports = router;
