'use strict';
const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/payrollController');

// Base: /api/payroll

// Configured pay items (allowances/deductions) per employee
router.get('/items', ctrl.listItems);
router.post('/items', ctrl.createItem);
router.put('/items/:id', ctrl.updateItem);
router.delete('/items/:id', ctrl.deleteItem);

// Payruns & payslips
router.get('/payruns', ctrl.listPayruns);
router.post('/payruns/generate', ctrl.generatePayrun);        // { period: 'YYYY-MM' }
router.get('/payslips', ctrl.listPayslips);                   // ?period=&employeeId=
router.post('/payslips/:id/mark-paid', ctrl.markPaid);

// Summary for dashboard/report
router.get('/summary', ctrl.summary);                         // ?period=YYYY-MM

// Optional dev seed
if (process.env.ENABLE_PAYROLL_DEV === 'true') {
  router.post('/dev/seed-items', ctrl.seedItems);
}

module.exports = router;
