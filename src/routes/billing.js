'use strict';
const router = require('express').Router();
const ctrl = require('../controllers/billingController');

// Tenant-facing
router.get('/me', ctrl.getCompanySummary);
router.get('/plans', ctrl.listPlans);
router.post('/plans/select', ctrl.updateCompanyPlan);
router.post('/invoices/generate', ctrl.generateInvoice);
router.post('/payments/record', ctrl.recordPayment);

// System task (protect with admin API key or role middleware)
router.post('/cron/daily', ctrl.runDailyBillingCycle);

module.exports = router;
