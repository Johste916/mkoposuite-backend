'use strict';
const express = require('express');
const router = express.Router();

let ctrl;
try {
  // Prefer real controller if present
  ctrl = require('../controllers/hrController');
} catch {
  // Safe, in-memory fallback so HR works in dev without controller/models
  const mem = {
    employees: [],
    attendance: [],
    leave: [],
    contracts: [],
  };
  let idSeq = 1;

  ctrl = {
    // Employees
    listEmployees: (_req, res) => res.json(mem.employees),
    getEmployee: (req, res) => {
      const e = mem.employees.find(x => String(x.id) === String(req.params.id));
      return e ? res.json(e) : res.status(404).json({ error: 'Not found' });
    },
    createEmployee: (req, res) => {
      const e = { id: idSeq++, status: 'active', ...req.body };
      mem.employees.push(e);
      res.status(201).json(e);
    },
    updateEmployee: (req, res) => {
      const i = mem.employees.findIndex(x => String(x.id) === String(req.params.id));
      if (i === -1) return res.status(404).json({ error: 'Not found' });
      mem.employees[i] = { ...mem.employees[i], ...req.body };
      res.json(mem.employees[i]);
    },
    deleteEmployee: (req, res) => {
      const i = mem.employees.findIndex(x => String(x.id) === String(req.params.id));
      if (i === -1) return res.status(404).json({ error: 'Not found' });
      const [removed] = mem.employees.splice(i, 1);
      res.json(removed);
    },

    // Attendance
    listAttendance: (_req, res) => res.json(mem.attendance),
    clockIn: (req, res) => {
      const row = { id: idSeq++, employeeId: req.body.employeeId, inAt: new Date().toISOString(), outAt: null };
      mem.attendance.push(row);
      res.status(201).json(row);
    },
    clockOut: (req, res) => {
      const row = mem.attendance.find(r => r.employeeId === req.body.employeeId && !r.outAt);
      if (!row) return res.status(404).json({ error: 'No active clock-in' });
      row.outAt = new Date().toISOString();
      res.json(row);
    },

    // Leave
    listLeave: (_req, res) => res.json(mem.leave),
    createLeave: (req, res) => {
      const row = { id: idSeq++, status: 'PENDING', ...req.body };
      mem.leave.push(row);
      res.status(201).json(row);
    },
    updateLeaveStatus: (req, res) => {
      const row = mem.leave.find(x => String(x.id) === String(req.params.id));
      if (!row) return res.status(404).json({ error: 'Not found' });
      row.status = req.body.status || row.status;
      res.json(row);
    },

    // Contracts
    listContracts: (_req, res) => res.json(mem.contracts),
    createContract: (req, res) => {
      const row = { id: idSeq++, ...req.body };
      mem.contracts.push(row);
      res.status(201).json(row);
    },
    updateContract: (req, res) => {
      const row = mem.contracts.find(x => String(x.id) === String(req.params.id));
      if (!row) return res.status(404).json({ error: 'Not found' });
      Object.assign(row, req.body);
      res.json(row);
    },

    // Dev seed
    seedBasic: (_req, res) => {
      mem.employees = [
        { id: idSeq++, name: 'Jane Employee', email: 'jane@example.com', role: 'Officer', status: 'active' },
        { id: idSeq++, name: 'John Staff', email: 'john@example.com', role: 'Accountant', status: 'active' },
      ];
      res.json({ ok: true, employees: mem.employees });
    }
  };
}

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
