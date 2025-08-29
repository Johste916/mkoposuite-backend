'use strict';
const { Op } = require('sequelize');

let db = {};
try { db = require('../models'); } catch { /* noop */ }

const getModel = (name) => {
  const m = db?.[name] || db?.sequelize?.models?.[name];
  if (!m) throw Object.assign(new Error(`Model "${name}" not found`), { status: 500, expose: true });
  return m;
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

/* ----------------------------- Employees --------------------------------- */
exports.listEmployees = async (req, res, next) => {
  try {
    const Employee = getModel('Employee');
    const where = { ...tenantFilter(Employee, req) };
    if (req.query.status) where.status = req.query.status;
    if (req.query.branchId && Employee.rawAttributes.branchId) where.branchId = req.query.branchId;
    const rows = await Employee.findAll({ where, order: [['lastName','ASC'], ['firstName','ASC']] });
    res.json(rows);
  } catch (e) { next(e); }
};

exports.getEmployee = async (req, res, next) => {
  try {
    const Employee = getModel('Employee');
    const where = { id: req.params.id, ...tenantFilter(Employee, req) };
    const row = await Employee.findOne({ where });
    if (!row) return res.status(404).json({ error: 'Employee not found' });
    res.json(row);
  } catch (e) { next(e); }
};

exports.createEmployee = async (req, res, next) => {
  try {
    const Employee = getModel('Employee');
    const rec = { ...req.body, ...tenantFilter(Employee, req) };
    const row = await Employee.create(rec);
    res.status(201).json(row);
  } catch (e) { next(e); }
};

exports.updateEmployee = async (req, res, next) => {
  try {
    const Employee = getModel('Employee');
    const where = { id: req.params.id, ...tenantFilter(Employee, req) };
    const row = await Employee.findOne({ where });
    if (!row) return res.status(404).json({ error: 'Employee not found' });
    await row.update(req.body || {});
    res.json(row);
  } catch (e) { next(e); }
};

exports.deleteEmployee = async (req, res, next) => {
  try {
    const Employee = getModel('Employee');
    const where = { id: req.params.id, ...tenantFilter(Employee, req) };
    const n = await Employee.destroy({ where });
    if (!n) return res.status(404).json({ error: 'Employee not found' });
    res.json({ ok: true });
  } catch (e) { next(e); }
};

/* ----------------------------- Attendance --------------------------------- */
exports.listAttendance = async (req, res, next) => {
  try {
    const Attendance = getModel('Attendance');
    const where = { ...tenantFilter(Attendance, req) };
    if (req.query.employeeId) where.employeeId = req.query.employeeId;
    if (req.query.from || req.query.to) {
      where.date = {};
      if (req.query.from) where.date[Op.gte] = req.query.from;
      if (req.query.to) where.date[Op.lte] = req.query.to;
    }
    const rows = await Attendance.findAll({ where, order: [['date','DESC'], ['id','DESC']] });
    res.json(rows);
  } catch (e) { next(e); }
};

exports.clockIn = async (req, res, next) => {
  try {
    const Attendance = getModel('Attendance');
    const { employeeId, date, time, note } = req.body || {};
    if (!employeeId) return res.status(400).json({ error: 'employeeId required' });

    const d = (date || new Date()).toISOString().slice(0,10);
    const t = time || new Date().toTimeString().slice(0,8);
    const where = { employeeId, date: d, ...tenantFilter(Attendance, req) };

    let row = await Attendance.findOne({ where });
    if (row) {
      if (!row.checkInTime) await row.update({ checkInTime: t, note: note || row.note });
    } else {
      row = await Attendance.create({ ...where, checkInTime: t, status: 'present', note: note || null });
    }
    res.status(201).json(row);
  } catch (e) { next(e); }
};

exports.clockOut = async (req, res, next) => {
  try {
    const Attendance = getModel('Attendance');
    const { employeeId, date, time, note } = req.body || {};
    if (!employeeId) return res.status(400).json({ error: 'employeeId required' });

    const d = (date || new Date()).toISOString().slice(0,10);
    const t = time || new Date().toTimeString().slice(0,8);
    const where = { employeeId, date: d, ...tenantFilter(Attendance, req) };

    const row = await Attendance.findOne({ where });
    if (!row) return res.status(404).json({ error: 'No attendance to clock-out; call clock-in first.' });

    let hoursWorked = row.hoursWorked || 0;
    if (row.checkInTime && t) {
      // crude hours calc (HH:MM:SS)
      const h1 = row.checkInTime.split(':').map(Number);
      const h2 = t.split(':').map(Number);
      const sec = (h2[0]*3600 + h2[1]*60 + h2[2]) - (h1[0]*3600 + h1[1]*60 + h1[2]);
      if (!Number.isNaN(sec) && sec > 0) hoursWorked = Math.round((sec/3600)*100)/100;
    }
    await row.update({ checkOutTime: t, hoursWorked, note: note || row.note });
    res.json(row);
  } catch (e) { next(e); }
};

/* -------------------------------- Leave ------------------------------------ */
exports.listLeave = async (req, res, next) => {
  try {
    const LeaveRequest = getModel('LeaveRequest');
    const where = { ...tenantFilter(LeaveRequest, req) };
    if (req.query.employeeId) where.employeeId = req.query.employeeId;
    if (req.query.status) where.status = req.query.status;
    const rows = await LeaveRequest.findAll({ where, order: [['startDate','DESC']] });
    res.json(rows);
  } catch (e) { next(e); }
};

exports.createLeave = async (req, res, next) => {
  try {
    const LeaveRequest = getModel('LeaveRequest');
    const rec = { ...req.body, ...tenantFilter(LeaveRequest, req) };
    if (!rec.employeeId || !rec.startDate || !rec.endDate) {
      return res.status(400).json({ error: 'employeeId, startDate, endDate required' });
    }
    rec.status = rec.status || 'pending';
    const row = await LeaveRequest.create(rec);
    res.status(201).json(row);
  } catch (e) { next(e); }
};

exports.updateLeaveStatus = async (req, res, next) => {
  try {
    const LeaveRequest = getModel('LeaveRequest');
    const { status } = req.body || {};
    const where = { id: req.params.id, ...tenantFilter(LeaveRequest, req) };
    const row = await LeaveRequest.findOne({ where });
    if (!row) return res.status(404).json({ error: 'Leave not found' });
    await row.update({ status });
    res.json(row);
  } catch (e) { next(e); }
};

/* ------------------------------- Contracts --------------------------------- */
exports.listContracts = async (req, res, next) => {
  try {
    const Contract = getModel('Contract');
    const where = { ...tenantFilter(Contract, req) };
    if (req.query.employeeId) where.employeeId = req.query.employeeId;
    const rows = await Contract.findAll({ where, order: [['startDate','DESC'], ['id','DESC']] });
    res.json(rows);
  } catch (e) { next(e); }
};

exports.createContract = async (req, res, next) => {
  try {
    const Contract = getModel('Contract');
    const rec = { ...req.body, ...tenantFilter(Contract, req) };
    if (!rec.employeeId || !rec.startDate) {
      return res.status(400).json({ error: 'employeeId and startDate required' });
    }
    const row = await Contract.create(rec);
    res.status(201).json(row);
  } catch (e) { next(e); }
};

exports.updateContract = async (req, res, next) => {
  try {
    const Contract = getModel('Contract');
    const where = { id: req.params.id, ...tenantFilter(Contract, req) };
    const row = await Contract.findOne({ where });
    if (!row) return res.status(404).json({ error: 'Contract not found' });
    await row.update(req.body || {});
    res.json(row);
  } catch (e) { next(e); }
};

/* ----------------------------- Dev seed (optional) ------------------------- */
exports.seedBasic = async (_req, res, next) => {
  try {
    const Employee = getModel('Employee');
    const count = await Employee.count();
    if (count > 0) return res.json({ ok: true, note: 'Employees already exist' });

    const rows = await Employee.bulkCreate([
      { firstName: 'John', lastName: 'Doe', email: 'john@example.com', status: 'active', salaryBase: 800000 },
      { firstName: 'Jane', lastName: 'Smith', email: 'jane@example.com', status: 'active', salaryBase: 950000 },
    ]);
    res.json({ ok: true, created: rows.length });
  } catch (e) { next(e); }
};
