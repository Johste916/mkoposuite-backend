'use strict';
const fs = require('fs');
const path = require('path');
const { Op } = require('sequelize');

let db = {};
try { db = require('../models'); } catch {} // soft in dev

/* --------------------------- helpers / fallbacks --------------------------- */
const DATA_DIR = path.resolve(__dirname, '../uploads/devdata');
fs.mkdirSync(DATA_DIR, { recursive: true });

const F = (file, fallback) => {
  try { return JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), 'utf8')); } catch { return fallback; }
};
const W = (file, data) => { try { fs.writeFileSync(path.join(DATA_DIR, file), JSON.stringify(data, null, 2)); } catch {} };

const state = {
  employees: F('employees.json', []),
  attendance: F('attendance.json', []),
  leaveTypes: F('leave_types.json', [
    { id: 1, name: 'Annual', days: 21 },
    { id: 2, name: 'Sick', days: 7 },
    { id: 3, name: 'Maternity/Paternity', days: 84 },
  ]),
  leaves: F('leave_requests.json', []),
  contracts: F('contracts.json', []),
};

const getModel = (name) => {
  const m = db?.[name] || db?.sequelize?.models?.[name];
  return m || null;
};
const tenantFilter = (model, req) => {
  const key = model?.rawAttributes?.tenantId ? 'tenantId'
            : model?.rawAttributes?.tenant_id ? 'tenant_id'
            : null;
  const tenantId =
    req?.tenant?.id ||
    req?.headers?.['x-tenant-id'] ||
    process.env.DEFAULT_TENANT_ID ||
    null;
  return key && tenantId ? { [key]: tenantId } : {};
};

/* -------------------------------- Employees -------------------------------- */
exports.listEmployees = async (req, res) => {
  const Employee = getModel('Employee');
  if (Employee) {
    try {
      const where = { ...tenantFilter(Employee, req) };
      if (req.query.status) where.status = req.query.status;
      if (req.query.branchId && Employee.rawAttributes.branchId) where.branchId = req.query.branchId;
      const rows = await Employee.findAll({ where, order: [['lastName','ASC'], ['firstName','ASC']] });
      return res.json({ items: rows });
    } catch {}
  }
  // file fallback
  return res.json({ items: state.employees });
};

exports.getEmployee = async (req, res) => {
  const Employee = getModel('Employee');
  if (Employee) {
    try {
      const row = await Employee.findOne({ where: { id: req.params.id, ...tenantFilter(Employee, req) } });
      if (!row) return res.status(404).json({ message: 'Employee not found' });
      return res.json(row);
    } catch {}
  }
  const row = state.employees.find(e => String(e.id) === String(req.params.id));
  if (!row) return res.status(404).json({ message: 'Employee not found' });
  res.json(row);
};

exports.createEmployee = async (req, res) => {
  const Employee = getModel('Employee');
  const rec = { ...(req.body || {}) };
  if (Employee) {
    try {
      const row = await Employee.create({ ...rec, ...tenantFilter(Employee, req) });
      return res.status(201).json(row);
    } catch {}
  }
  const row = { id: (state.employees[0]?.id || 0) + 1, ...rec };
  state.employees.unshift(row); W('employees.json', state.employees);
  res.status(201).json(row);
};

exports.updateEmployee = async (req, res) => {
  const Employee = getModel('Employee');
  if (Employee) {
    try {
      const where = { id: req.params.id, ...tenantFilter(Employee, req) };
      const row = await Employee.findOne({ where });
      if (!row) return res.status(404).json({ message: 'Employee not found' });
      await row.update(req.body || {});
      return res.json(row);
    } catch {}
  }
  const i = state.employees.findIndex(x => String(x.id) === String(req.params.id));
  if (i === -1) return res.status(404).json({ message: 'Employee not found' });
  state.employees[i] = { ...state.employees[i], ...(req.body || {}) };
  W('employees.json', state.employees);
  res.json(state.employees[i]);
};

exports.deleteEmployee = async (req, res) => {
  const Employee = getModel('Employee');
  if (Employee) {
    try {
      const where = { id: req.params.id, ...tenantFilter(Employee, req) };
      const n = await Employee.destroy({ where });
      if (!n) return res.status(404).json({ message: 'Employee not found' });
      return res.json({ ok: true });
    } catch {}
  }
  const before = state.employees.length;
  state.employees = state.employees.filter(e => String(e.id) !== String(req.params.id));
  W('employees.json', state.employees);
  if (state.employees.length === before) return res.status(404).json({ message: 'Employee not found' });
  res.json({ ok: true });
};

/* -------------------------------- Attendance ------------------------------- */
exports.listAttendance = async (req, res) => {
  const Attendance = getModel('Attendance');
  if (Attendance) {
    try {
      const where = { ...tenantFilter(Attendance, req) };
      if (req.query.employeeId) where.employeeId = req.query.employeeId;
      if (req.query.from || req.query.to) {
        where.date = {};
        if (req.query.from) where.date[Op.gte] = req.query.from;
        if (req.query.to) where.date[Op.lte] = req.query.to;
      }
      const rows = await Attendance.findAll({ where, order: [['date','DESC'], ['id','DESC']] });
      return res.json({ items: rows });
    } catch {}
  }
  // file
  let rows = [...state.attendance];
  if (req.query.employeeId) rows = rows.filter(x => String(x.employeeId) === String(req.query.employeeId));
  if (req.query.date) rows = rows.filter(x => x.date === req.query.date);
  return res.json({ items: rows });
};

/* ---------------------------------- Leave ---------------------------------- */
exports.listLeaveTypes = async (_req, res) => res.json({ items: state.leaveTypes });

exports.myLeaveRequests = async (req, res) => {
  const userId = req.user?.id || req.headers['x-user-id'] || null;
  const Leave = getModel('LeaveRequest');
  if (Leave && userId) {
    try {
      const rows = await Leave.findAll({ where: { employeeId: userId }, order: [['startDate','DESC']] });
      return res.json({ items: rows });
    } catch {}
  }
  const items = userId ? state.leaves.filter(l => String(l.employeeId) === String(userId)) : state.leaves;
  res.json({ items });
};

exports.createLeave = async (req, res) => {
  const Leave = getModel('LeaveRequest');
  const rec = { ...(req.body || {}) };
  if (!rec.employeeId) rec.employeeId = req.user?.id || req.headers['x-user-id'] || null;
  if (!rec.employeeId || !rec.from || !rec.to) return res.status(400).json({ message: 'employeeId, from, to are required' });
  rec.status = rec.status || 'pending';
  if (Leave) {
    try {
      const row = await Leave.create({ ...rec, startDate: rec.from, endDate: rec.to, paid: !!rec.paid, reason: rec.reason || '', });
      return res.status(201).json(row);
    } catch {}
  }
  const row = { id: (state.leaves[0]?.id || 0) + 1, ...rec };
  state.leaves.unshift(row); W('leave_requests.json', state.leaves);
  res.status(201).json(row);
};

/* --------------------------------- Contracts ------------------------------- */
exports.listContracts = async (req, res) => {
  const Contract = getModel('Contract');
  if (Contract) {
    try {
      const where = { ...tenantFilter(Contract, req) };
      if (req.query.employeeId) where.employeeId = req.query.employeeId;
      const rows = await Contract.findAll({ where, order: [['startDate','DESC'], ['id','DESC']] });
      return res.json({ items: rows });
    } catch {}
  }
  res.json({ items: state.contracts });
};

exports.createContract = async (req, res) => {
  const Contract = getModel('Contract');
  const rec = { ...(req.body || {}) };
  if (req.file) rec.fileUrl = `/uploads/contracts/${req.file.filename}`;
  if (!rec.employeeId || !rec.startDate) return res.status(400).json({ message: 'employeeId and startDate required' });
  if (Contract) {
    try {
      const row = await Contract.create(rec);
      return res.status(201).json(row);
    } catch {}
  }
  const row = { id: (state.contracts[0]?.id || 0) + 1, ...rec };
  state.contracts.unshift(row); W('contracts.json', state.contracts);
  res.status(201).json(row);
};
