'use strict';
const express = require('express');
const router = express.Router();
const { authenticateUser } = require('../middleware/authMiddleware');
const ctrl = require('../controllers/tenantController');

// Current company's tenant settings (protected)
router.get('/me', authenticateUser, ctrl.me);
router.patch('/me', authenticateUser, ctrl.updateMe);
router.get('/me/entitlements', authenticateUser, ctrl.entitlements);

// NEW: limits & invoices (self-service views)
router.get('/me/limits', authenticateUser, ctrl.limits);
router.get('/me/invoices', authenticateUser, ctrl.invoices);

// Optional: admin/ops endpoint for billing checks (protect with a secret if you like)
router.post('/admin/billing/cron-check', ctrl.cronCheck);

module.exports = router;
