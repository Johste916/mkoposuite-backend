// backend/src/routes/payrollRoutes.js
'use strict';
const express = require('express');
const router = express.Router();

let models = null;
try { models = require('../models'); } catch { try { models = require('../../models'); } catch {} }

// in-memory runs so the UI has data without DB yet
const runs = [];

/** lightweight permission: allow admin, director, payroll_admin.
 * In development (no req.user), we allow by default so you can test.
 */
function canRun(req) {
  const role = String(
    req.user?.role ||
    (Array.isArray(req.user?.Roles) && req.user.Roles[0]?.name) ||
    req.headers['x-role'] || ''
  ).toLowerCase();

  if (!role && process.env.NODE_ENV !== 'production') return true;
  return ['admin', 'director', 'payroll_admin'].includes(role);
}

/* ---------------------------- LIST / FILTER ---------------------------- */
// Supports /api/payroll and /api/payroll/runs for flexibility
const listPaths = ['/', '/runs'];
listPaths.forEach(p => {
  router.get(p, async (req, res) => {
    const { from, to } = req.query || {};
    // If you already have a DB model, prefer that.
    if (models?.PayrollRun?.findAll) {
      try {
        const where = {};
        if (from) where.periodStart = { [models.Sequelize.Op.gte]: from };
        if (to) where.periodEnd = { ...(where.periodEnd||{}), [models.Sequelize.Op.lte]: to };
        const rows = await models.PayrollRun.findAll({ where, order: [['createdAt','DESC']] });
        return res.json(rows);
      } catch (e) { /* fall back */ }
    }

    // memory filter
    let out = runs;
    if (from) out = out.filter(r => !r.periodStart || r.periodStart >= from);
    if (to) out = out.filter(r => !r.periodEnd || r.periodEnd <= to);
    res.json(out);
  });
});

/* ------------------------------ RUN PAYROLL ------------------------------ */
router.post('/run', async (req, res) => {
  if (!canRun(req)) {
    return res.status(403).json({ error: "You don't have permission to run payroll." });
  }

  // Use employees from DB if available; otherwise empty list (or derive from request)
  let employees = [];
  if (models?.Employee?.findAll) {
    try {
      employees = await models.Employee.findAll();
    } catch { /* ignore */ }
  }

  const {
    period = new Date().toISOString().slice(0,7), // YYYY-MM
    periodStart,
    periodEnd,
    items = [], // optional [{ employeeId, gross, allowances, deductions }]
  } = req.body || {};

  // Build simple run
  const id = runs.length + 1;
  const indexed = new Map(items.map(x => [String(x.employeeId), x]));

  const lines = (employees.length ? employees : items).map(e => {
    const idStr = String(e.id || e.employeeId);
    const line = indexed.get(idStr) || e;
    const base = Number(e.baseSalary || line.baseSalary || line.gross || 0);
    const allowances = Number(line.allowances || 0);
    const deductions = Number(line.deductions || 0);
    const gross = base + allowances;
    const net = gross - deductions;
    return {
      employeeId: e.id || line.employeeId,
      name: [e.firstName, e.lastName].filter(Boolean).join(' ') || line.name || '',
      gross, allowances, deductions, net,
    };
  });

  const totalGross = lines.reduce((s, x) => s + (Number(x.gross)||0), 0);
  const totalNet = lines.reduce((s, x) => s + (Number(x.net)||0), 0);

  const run = {
    id,
    period,
    periodStart: periodStart || (period + '-01'),
    periodEnd: periodEnd || (period + '-28'),
    staffCount: lines.length,
    totalGross,
    totalNet,
    status: 'COMPLETED',
    lines,
    createdAt: new Date().toISOString(),
  };

  // Persist to DB if present
  if (models?.PayrollRun?.create) {
    try {
      const saved = await models.PayrollRun.create({
        period: run.period,
        periodStart: run.periodStart,
        periodEnd: run.periodEnd,
        staffCount: run.staffCount,
        totalGross: run.totalGross,
        totalNet: run.totalNet,
        status: run.status,
        meta: { lines: run.lines },
      });
      return res.status(201).json(saved);
    } catch { /* fall back to memory */ }
  }

  runs.unshift(run);
  res.status(201).json(run);
});

/* ------------------------------ PAYSLIPS ------------------------------ */
router.get('/payslips', async (req, res) => {
  const { employeeId, period } = req.query || {};
  // DB path
  if (models?.PayrollRun?.findOne) {
    try {
      const where = period ? { period } : {};
      const row = await models.PayrollRun.findOne({ where, order: [['createdAt','DESC']] });
      if (row?.meta?.lines) {
        const lines = employeeId ? row.meta.lines.filter(l => String(l.employeeId) === String(employeeId)) : row.meta.lines;
        return res.json(lines);
      }
    } catch {}
  }
  // memory path
  const row = runs.find(r => r.period === period) || runs[0];
  const lines = row ? (employeeId ? row.lines.filter(l => String(l.employeeId) === String(employeeId)) : row.lines) : [];
  res.json(lines || []);
});

module.exports = router;
