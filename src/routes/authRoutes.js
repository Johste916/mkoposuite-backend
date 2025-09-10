'use strict';
const express = require('express');
const router = express.Router();

/* ───────── Try to load middleware (fallbacks if missing) ───────── */
let authenticateUser, requireAuth, me;
try {
  ({ authenticateUser, requireAuth, me } = require('../middleware/authMiddleware'));
} catch (e) {
  console.warn('[authRoutes] authMiddleware not fully available:', e.message);
}

const authMW    = typeof authenticateUser === 'function' ? authenticateUser : (_req, _res, next) => next();
const requireMW = typeof requireAuth === 'function'     ? requireAuth     : (_req, _res, next) => next();
const meHandler = typeof me === 'function'               ? me              : (req, res) => res.json(req.user || {});

/* ───────── Try to load controllers (fallbacks if missing) ───────── */
let login, getTwoFAStatus, setupTwoFA, verifyTwoFA, disableTwoFA;
try {
  ({ login, getTwoFAStatus, setupTwoFA, verifyTwoFA, disableTwoFA } =
    require('../controllers/authController'));
} catch (e) {
  console.warn('[authRoutes] authController not fully available:', e.message);
}

/* If any controller is missing, respond 501 instead of crashing */
const notImpl = (name) => (_req, res) => res.status(501).json({ error: `${name} not implemented` });
const ensure  = (fn, name) => (typeof fn === 'function' ? fn : notImpl(name));

/* ───────── Routes (unchanged paths) ───────── */
// /api/login  and  /api/auth/login
router.post('/',       ensure(login, 'login'));
router.post('/login',  ensure(login, 'login'));

// Current user
router.get('/me',     authMW, requireMW, meHandler);
router.get('/whoami', authMW, requireMW, meHandler);

// 2FA
router.get('/2fa/status',   authMW, requireMW, ensure(getTwoFAStatus, 'getTwoFAStatus'));
router.post('/2fa/setup',   authMW, requireMW, ensure(setupTwoFA,    'setupTwoFA'));
router.post('/2fa/verify',  authMW, requireMW, ensure(verifyTwoFA,   'verifyTwoFA'));
router.post('/2fa/disable', authMW, requireMW, ensure(disableTwoFA,  'disableTwoFA'));

module.exports = router;
