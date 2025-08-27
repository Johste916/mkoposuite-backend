'use strict';

const express = require('express');
const router = express.Router();

const { login, getTwoFAStatus } = require('../controllers/authController');

// Support both mounts:
//
// app.use('/api/login', authRoutes) -> POST /api/login
// app.use('/api/auth',  authRoutes) -> POST /api/auth/login
router.post('/', login);
router.post('/login', login);

// 2FA status used by the UI
router.get('/2fa/status', getTwoFAStatus);

module.exports = router;
