'use strict';
const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/tenantController');

// Tenants (current company context)
router.get('/me', ctrl.me);
router.patch('/me', ctrl.updateMe);
router.get('/me/entitlements', ctrl.entitlements);

// Admin/ops: run this daily (Render cron / GitHub Actions / curl)
router.post('/admin/billing/cron-check', ctrl.cronCheck);

module.exports = router;
