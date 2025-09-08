// server/routes/tenantRoutes.js
'use strict';
const express = require('express');
const router = express.Router();
const { authenticateUser } = require('../middleware/authMiddleware');
const ctrl = require('../controllers/tenantController');

// Current company
router.get('/me', authenticateUser, ctrl.me);
router.patch('/me', authenticateUser, ctrl.updateMe);
router.get('/me/entitlements', authenticateUser, ctrl.entitlements);

// Self-service limits & invoices
router.get('/me/limits', authenticateUser, ctrl.getLimits);
router.patch('/me/limits', authenticateUser, ctrl.setLimits);
router.get('/me/invoices', authenticateUser, ctrl.listInvoices);

// Optional: generic path some frontends try (/tenants/:id/invoices)
router.get('/:id/invoices', authenticateUser, ctrl.listInvoices);

// Billing checker (ops)
router.post('/admin/billing/cron-check', ctrl.cronCheck);

module.exports = router;
