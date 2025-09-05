'use strict';

const express = require('express');
const router = express.Router();
const { authenticateUser } = require('../middleware/authMiddleware');

// ✅ use the new controller that includes profile/prefs/notifications/sessions/avatar
const account = require('../controllers/account/accountSettingsController');

// Profile / identity
router.get('/me', authenticateUser, account.getMe);
router.put('/me', authenticateUser, account.updateMe);

// Preferences
router.get('/preferences', authenticateUser, account.getPreferences);
router.put('/preferences', authenticateUser, account.updatePreferences);

// Notifications
router.get('/notifications', authenticateUser, account.getNotifications);
router.put('/notifications', authenticateUser, account.updateNotifications);

// Security sessions
router.get('/security/sessions', authenticateUser, account.getSessions);
router.post('/security/sessions/revoke-all', authenticateUser, account.revokeAllSessions);

// Avatar upload (multipart/form-data, field name: "avatar")
router.post('/avatar', authenticateUser, account.uploadAvatar);

// Billing (kept for compatibility)
router.get('/billing', authenticateUser, account.getBilling);
router.put('/billing', authenticateUser, account.updateBilling);

// Change password
router.post('/change-password', authenticateUser, account.changePassword);

module.exports = router;
