'use strict';

const express = require('express');
const router = express.Router();

// Pull in the enriched auth middleware (now exposes requireAuth + me)
const { authenticateUser, requireAuth, me } = require('../middleware/authMiddleware');

const {
  login,
  getTwoFAStatus,
  setupTwoFA,
  verifyTwoFA,
  disableTwoFA,
} = require('../controllers/authController');

/**
 * This router intentionally supports BOTH mounts:
 *   app.use('/api/login', authRoutes)  -> POST /api/login
 *   app.use('/api/auth',  authRoutes)  -> POST /api/auth/login
 */
router.post('/', login);          // /api/login
router.post('/login', login);     // /api/auth/login

/* ----------------------------- Current user ----------------------------- */
/** Frontend expects GET /api/auth/me */
router.get('/me', authenticateUser, requireAuth, me);
// Optional alias if any code calls /api/auth/whoami
router.get('/whoami', authenticateUser, requireAuth, me);

/* --------------------------------- 2FA ---------------------------------- */
// GET    /api/auth/2fa/status
// POST   /api/auth/2fa/setup
// POST   /api/auth/2fa/verify  { token }
// POST   /api/auth/2fa/disable { token }
router.get('/2fa/status',  authenticateUser, requireAuth, getTwoFAStatus);
router.post('/2fa/setup',  authenticateUser, requireAuth, setupTwoFA);
router.post('/2fa/verify', authenticateUser, requireAuth, verifyTwoFA);
router.post('/2fa/disable',authenticateUser, requireAuth, disableTwoFA);

module.exports = router;
