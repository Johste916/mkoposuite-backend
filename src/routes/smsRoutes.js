'use strict';
const express = require('express');
const router = express.Router();

let authenticateUser;
try { ({ authenticateUser } = require('../middleware/authMiddleware')); } catch {}
const auth = authenticateUser ? [authenticateUser] : [];

const ctrl = require('../controllers/smsController');

/**
 * We expose several paths to stay compatible with older frontends:
 *
 *  POST /api/sms/send                 (preferred)
 *  POST /api/communications/sms/send  (legacy)
 *  POST /api/notifications/sms        (legacy)
 *
 *  GET  /api/sms/messages
 *  GET  /api/sms/balance
 */

// preferred base (/api/sms/*)
router.post('/send', ...auth, ctrl.send);
router.get('/messages', ...auth, ctrl.messages);
router.get('/balance', ...auth, ctrl.balance);

// when mounted at /api/communications
router.post('/sms/send', ...auth, ctrl.send);

// when mounted at /api/notifications
router.post('/sms', ...auth, ctrl.send);

module.exports = router;
