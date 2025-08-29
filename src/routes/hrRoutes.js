'use strict';
const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/hrController');

// Base: /api/hr
// Employees
router.get('/employees', ctrl.listEmployees);
router.get('/employees/:id', ctrl.getEmployee);
router.post('/employees', ctrl.createEmployee);
router.put('/employees/:id', ctrl.updateEmployee);
router.delete('/employees/:id', ctrl.deleteEmployee);

// Attendance
router.get('/attendance', ctrl.listAttendance);
router.post('/attendance/clock-in', ctrl.clockIn);
router.post('/attendance/clock-out', ctrl.clockOut);

// Leave
router.get('/leave', ctrl.listLeave);
router.post('/leave', ctrl.createLeave);
router.patch('/leave/:id/status', ctrl.updateLeaveStatus);

// Contracts
router.get('/contracts', ctrl.listContracts);
router.post('/contracts', ctrl.createContract);
router.put('/contracts/:id', ctrl.updateContract);

// Optional: quick seed for dev
if (process.env.ENABLE_HR_DEV === 'true') {
  router.post('/dev/seed-basic', ctrl.seedBasic);
}

module.exports = router;
