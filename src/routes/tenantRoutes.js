'use strict';
const express = require('express');
const router = express.Router();
const { authenticateUser } = require('../middleware/authMiddleware');
const ctrl = require('../controllers/tenantController');

// Current company's tenant settings (protected)
router.get('/me', authenticateUser, ctrl.me);
router.patch('/me', authenticateUser, ctrl.updateMe);
router.get('/me/entitlements', authenticateUser, ctrl.entitlements);

// NEW self-service
router.get('/me/limits', authenticateUser, ctrl.getLimits);
router.patch('/me/limits', authenticateUser, ctrl.setLimits);
router.get('/me/invoices', authenticateUser, ctrl.listInvoices);

// Optional: admin/ops endpoint for billing checks
router.post('/admin/billing/cron-check', ctrl.cronCheck);

module.exports = router;
