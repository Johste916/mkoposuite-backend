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

/**
 * Supports both mounts:
 * - app.use('/api/login', authRoutes) -> POST /api/login
 * - app.use('/api/auth',  authRoutes) -> POST /api/auth/login
 */
router.post('/', login);          // /api/login
router.post('/login', login);     // /api/auth/login

// 2FA endpoints (require auth). Frontend calls these:
// GET    /api/auth/2fa/status
// POST   /api/auth/2fa/setup
// POST   /api/auth/2fa/verify  { token }
// POST   /api/auth/2fa/disable { token }
router.get('/2fa/status', authenticateUser, getTwoFAStatus);
router.post('/2fa/setup', authenticateUser, setupTwoFA);
router.post('/2fa/verify', authenticateUser, verifyTwoFA);
router.post('/2fa/disable', authenticateUser, disableTwoFA);

module.exports = router;
