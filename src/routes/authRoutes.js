'use strict';

const express = require('express');
const router = express.Router();

// enriched auth middleware
const { authenticateUser, requireAuth, me } = require('../middleware/authMiddleware');

const {
  login,
  getTwoFAStatus,
  setupTwoFA,
  verifyTwoFA,
  disableTwoFA,
} = require('../controllers/authController');

/**
 * Supports BOTH mounts:
 *   app.use('/api/login', authRoutes)  -> POST /api/login
 *   app.use('/api/auth',  authRoutes) -> POST /api/auth/login
 */
router.post('/', login);          // /api/login
router.post('/login', login);     // /api/auth/login

/* current user */
router.get('/me', authenticateUser, requireAuth, me);
router.get('/whoami', authenticateUser, requireAuth, me);

/* 2FA */
router.get('/2fa/status',  authenticateUser, requireAuth, getTwoFAStatus);
router.post('/2fa/setup',  authenticateUser, requireAuth, setupTwoFA);
router.post('/2fa/verify', authenticateUser, requireAuth, verifyTwoFA);
router.post('/2fa/disable',authenticateUser, requireAuth, disableTwoFA);

module.exports = router;
