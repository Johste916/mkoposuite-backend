'use strict';
const fs = require('fs');
const path = require('path');
const { Op } = require('sequelize');

let db = {};
try { db = require('../models'); } catch {} // tolerate missing models for dev

/* --------------------------- helpers / fallbacks --------------------------- */
const DATA_DIR = path.resolve(__dirname, '../uploads/devdata');
fs.mkdirSync(DATA_DIR, { recursive: true });

const F = (file, fallback) => {
  try { return JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), 'utf8')); } catch { return fallback; }
};
const W = (file, data) => { try { fs.writeFileSync(path.join(DATA_DIR, file), JSON.stringify(data, null, 2)); } catch {} };

const state = {
  items: F('payroll_items.json', []),     // allowances/deductions definitions
  runs:  F('payroll_runs.json', []),      // created runs
  slips: F('payroll_payslips.json', []),  // generated payslips
};

const getModel = (name) => {
  const m = db?.[name] || db?.sequelize?.models?.[name];
  return m || null; // return null so we can fall back gracefully
};
const tenantFilter = (model, req) => {
  const key = model?.rawAttributes?.tenantId ? 'tenantId'
            : model?.rawAttributes?.tenant_id ? 'tenant_id' : null;
  const tenantId =
    req?.tenant?.id ||
    req?.headers?.['x-tenant-id'] ||
    process.env.DEFAULT_TENANT_ID ||
    null;
  return key && tenantId ? { [key]: tenantId } : {};
};
const asMoney = (v) => Math.round(Number(v || 0) * 100) / 100;

/* --------------------------------- Items ---------------------------------- */
exports.listItems = async (req, res) => {
  const Item = getModel('PayrollItem');
  if (Item) {
    try {
      const where = { ...tenantFilter(Item, req) };
      if (req.query.employeeId) where.employeeId = req.query.employeeId;
      const rows = await Item.findAll({ where, order: [['employeeId','ASC'],['name','ASC']] });
      return res.json({ items: rows });
    } catch {}
  }
  // dev fallback
  const rows = state.items.filter(x => !req.query.employeeId || String(x.employeeId) === String(req.query.employeeId));
  return res.json({ items: rows });
};

exports.createItem = async (req, res) => {
  const Item = getModel('PayrollItem');
  const rec = req.body || {};
  if (!rec.employeeId || !rec.type || !rec.name) {
    return res.status(400).json({ message: 'employeeId, type, name are required' });
  }
  if (Item) {
    try {
      const row = await Item.create({ ...rec, ...tenantFilter(Item, req) });
      return res.status(201).json(row);
    } catch (e) {
      // fall through to file mode
    }
  }
  // file mode
  const row = { id: state.items.length + 1, ...rec };
  state.items.push(row); W('payroll_items.json', state.items);
  res.status(201).json(row);
};

exports.updateItem = async (req, res) => {
  const Item = getModel('PayrollItem');
  if (Item) {
    try {
      const where = { id: req.params.id, ...tenantFilter(Item, req) };
      const row = await Item.findOne({ where });
      if (!row) return res.status(404).json({ message: 'Item not found' });
      await row.update(req.body || {});
      return res.json(row);
    } catch {}
  }
  // file mode
  const i = state.items.findIndex(x => String(x.id) === String(req.params.id));
  if (i === -1) return res.status(404).json({ message: 'Item not found' });
  state.items[i] = { ...state.items[i], ...(req.body || {}) };
  W('payroll_items.json', state.items);
  res.json(state.items[i]);
};

exports.deleteItem = async (req, res) => {
  const Item = getModel('PayrollItem');
  if (Item) {
    try {
      const where = { id: req.params.id, ...tenantFilter(Item, req) };
      const n = await Item.destroy({ where });
      if (!n) return res.status(404).json({ message: 'Item not found' });
      return res.json({ ok: true });
    } catch {}
  }
  const before = state.items.length;
  state.items = state.items.filter(x => String(x.id) !== String(req.params.id));
  W('payroll_items.json', state.items);
  if (state.items.length === before) return res.status(404).json({ message: 'Item not found' });
  res.json({ ok: true });
};

/* ------------------------------ Payruns & API ------------------------------ */
/** GET /hr/payroll/runs */
exports.listRuns = async (req, res) => {
  const Payrun = getModel('Payrun');
  const where = Payrun ? { ...tenantFilter(Payrun, req) } : {};
  if (req.query.from || req.query.to) {
    if (Payrun) {
      where.periodStart = {};
      if (req.query.from) where.periodStart[Op.gte] = req.query.from;
      if (req.query.to) where.periodStart[Op.lte] = req.query.to;
    }
  }
  if (Payrun) {
    try {
      const rows = await Payrun.findAll({ where, order: [['createdAt','DESC']] });
      return res.json({ items: rows });
    } catch {}
  }
  // file fallback
  let items = [...state.runs];
  if (req.query.from) items = items.filter(r => !r.periodFrom || r.periodFrom >= req.query.from);
  if (req.query.to)   items = items.filter(r => !r.periodTo   || r.periodTo   <= req.query.to);
  res.json({ items });
};

/** GET /hr/payroll/runs/:id */
exports.getRun = async (req, res) => {
  const Payrun = getModel('Payrun');
  if (Payrun) {
    try {
      const row = await Payrun.findOne({ where: { id: req.params.id, ...tenantFilter(Payrun, req) } });
      if (!row) return res.status(404).json({ message: 'Run not found' });
      return res.json(row);
    } catch {}
  }
  const row = state.runs.find(r => String(r.id) === String(req.params.id) || String(r.runId) === String(req.params.id));
  if (!row) return res.status(404).json({ message: 'Run not found' });
  res.json(row);
};

/** POST /hr/payroll/runs  { periodFrom, periodTo, lines:[{ employeeId, base, allowances, overtime, deductions, advances, savings, loans }] } */
exports.createRun = async (req, res) => {
  const { periodFrom, periodTo, lines = [] } = req.body || {};
  if (!periodFrom || !periodTo) return res.status(400).json({ message: 'periodFrom and periodTo required' });

  // Try DB first
  const Payrun  = getModel('Payrun');
  const Payslip = getModel('Payslip');

  if (Payrun && Payslip && db?.sequelize?.transaction) {
    const t = await db.sequelize.transaction();
    try {
      const run = await Payrun.create({
        periodStart: periodFrom, periodEnd: periodTo, status: 'finalized',
        staffCount: lines.length,
        totalGross: 0, totalNet: 0,
        ...tenantFilter(Payrun, req)
      }, { transaction: t });

      let totalGross = 0, totalNet = 0;
      for (const l of lines) {
        const gross = asMoney(Number(l.base||0) + Number(l.allowances||0) + Number(l.overtime||0));
        const deductions = asMoney(Number(l.deductions||0) + Number(l.advances||0) + Number(l.savings||0) + Number(l.loans||0));
        const net = asMoney(gross - deductions);
        totalGross += gross; totalNet += net;
        await Payslip.create({
          payrunId: run.id,
          employeeId: l.employeeId,
          baseSalary: Number(l.base||0),
          totalAllowance: Number(l.allowances||0) + Number(l.overtime||0),
          totalDeduction: deductions,
          gross, netPay: net, status: 'unpaid',
          ...tenantFilter(Payslip, req)
        }, { transaction: t });
      }
      await run.update({ totalGross, totalNet }, { transaction: t });
      await t.commit();
      return res.status(201).json({ runId: run.id });
    } catch (e) {
      try { await t.rollback(); } catch {}
      // fall through to file mode
    }
  }

  // file mode
  const id = (state.runs[0]?.id || state.runs[0]?.runId || 0) + 1;
  const periodLabel = `${periodFrom} → ${periodTo}`;
  let totalGross = 0, totalNet = 0;
  const linesOut = lines.map(l => {
    const gross = asMoney(Number(l.base||0) + Number(l.allowances||0) + Number(l.overtime||0));
    const deductions = asMoney(Number(l.deductions||0) + Number(l.advances||0) + Number(l.savings||0) + Number(l.loans||0));
    const net = asMoney(gross - deductions);
    totalGross += gross; totalNet += net;
    return { ...l, gross, deductions, net };
  });
  const run = {
    id, runId: id, periodFrom, periodTo, periodLabel,
    staffCount: linesOut.length,
    totalGross, totalNet, status: 'finalized',
    lines: linesOut, createdAt: new Date().toISOString()
  };
  state.runs.unshift(run); W('payroll_runs.json', state.runs);
  // generate slips file-side as well
  linesOut.forEach(l => {
    state.slips.push({
      id: state.slips.length + 1,
      payrunId: id,
      employeeId: l.employeeId,
      gross: l.gross,
      netPay: l.net,
      createdAt: new Date().toISOString()
    });
  });
  W('payroll_payslips.json', state.slips);
  return res.status(201).json({ runId: id });
};

/** GET /hr/payroll/stats */
exports.stats = async (_req, res) => {
  // light aggregate; attempt DB then fall back
  try {
    const Employee = getModel('Employee');
    const Leave    = getModel('LeaveRequest');
    const Contract = getModel('Contract');
    const Payrun   = getModel('Payrun');

    if (Employee && Leave && Contract && Payrun) {
      const [employees, onLeave, activeContracts, latest] = await Promise.all([
        Employee.count({ where: { status: 'active' } }),
        Leave.count({ where: { status: 'approved' } }),
        Contract.count({ where: { endDate: { [Op.gte]: new Date().toISOString().slice(0,10) } } }),
        Payrun.findOne({ order: [['createdAt','DESC']] })
      ]);
      return res.json({
        employees, onLeave, activeContracts,
        netThisPeriod: latest?.totalNet || 0
      });
    }
  } catch {}
  // file fallback
  res.json({
    employees:  state.slips.reduce((set, s) => set.add(String(s.employeeId)), new Set()).size || 0,
    onLeave:    0,
    activeContracts: 0,
    netThisPeriod: state.runs[0]?.totalNet || 0,
  });
};

/** GET /hr/payroll/report?runId=...&from=...&to=...&employeeId=... */
exports.report = async (req, res) => {
  const runId = req.query.runId;
  // DB path if present
  const Payslip = getModel('Payslip');
  const Payrun  = getModel('Payrun');

  if (Payrun && Payslip) {
    try {
      let slips = [];
      if (runId) {
        const run = await Payrun.findOne({ where: { id: runId } });
        if (run) slips = await Payslip.findAll({ where: { payrunId: run.id } });
      } else {
        slips = await Payslip.findAll();
      }
      // simple aggregate shape
      const items = slips.map(s => ({
        id: s.id,
        employeeId: s.employeeId,
        employeeName: s.employee?.name,
        periodLabel: `${s.periodStart || ''} → ${s.periodEnd || ''}`,
        gross: Number(s.gross || s.baseSalary || 0) + Number(s.totalAllowance || 0),
        deductions: Number(s.totalDeduction || 0),
        net: Number(s.netPay || 0),
      }));
      const summary = {
        gross: items.reduce((a,b)=>a+Number(b.gross||0),0),
        deductions: items.reduce((a,b)=>a+Number(b.deductions||0),0),
        net: items.reduce((a,b)=>a+Number(b.net||0),0),
      };
      return res.json({ items, summary });
    } catch {}
  }

  // file fallback
  let items = [];
  if (runId) {
    const run = state.runs.find(r => String(r.id) === String(runId) || String(r.runId) === String(runId));
    if (run) {
      items = run.lines.map((l, idx) => ({
        id: idx + 1,
        employeeId: l.employeeId,
        employeeName: l.name,
        periodLabel: run.periodLabel,
        gross: l.gross,
        deductions: l.deductions,
        net: l.net,
      }));
    }
  } else {
    // combine all runs
    state.runs.forEach(r => {
      r.lines.forEach((l, idx) => {
        items.push({
          id: `${r.id}-${idx+1}`,
          employeeId: l.employeeId,
          employeeName: l.name,
          periodLabel: r.periodLabel,
          gross: l.gross, deductions: l.deductions, net: l.net
        });
      });
    });
  }
  const summary = {
    gross: items.reduce((a,b)=>a+Number(b.gross||0),0),
    deductions: items.reduce((a,b)=>a+Number(b.deductions||0),0),
    net: items.reduce((a,b)=>a+Number(b.net||0),0),
  };
  return res.json({ items, summary });
};

/* ------------------------------ Payslip ops ------------------------------- */
exports.listPayslips = async (req, res) => {
  const Payslip = getModel('Payslip');
  const Payrun  = getModel('Payrun');
  if (Payslip) {
    try {
      const where = {};
      if (req.query.employeeId) where.employeeId = req.query.employeeId;
      if (req.query.period) {
        const run = Payrun ? await Payrun.findOne({ where: { period: req.query.period } }) : null;
        where.payrunId = run ? run.id : -1;
      }
      const rows = await Payslip.findAll({ where, order: [['id','DESC']] });
      return res.json({ items: rows });
    } catch {}
  }
  // file
  let rows = [...state.slips];
  if (req.query.employeeId) rows = rows.filter(s => String(s.employeeId) === String(req.query.employeeId));
  res.json({ items: rows });
};

exports.markPaid = async (req, res) => {
  const Payslip = getModel('Payslip');
  if (Payslip) {
    try {
      const where = { id: req.params.id };
      const row = await Payslip.findOne({ where });
      if (!row) return res.status(404).json({ message: 'Payslip not found' });
      await row.update({ status: 'paid', paymentDate: new Date() });
      return res.json(row);
    } catch {}
  }
  const i = state.slips.findIndex(x => String(x.id) === String(req.params.id));
  if (i === -1) return res.status(404).json({ message: 'Payslip not found' });
  state.slips[i] = { ...state.slips[i], status: 'paid', paymentDate: new Date().toISOString() };
  W('payroll_payslips.json', state.slips);
  res.json(state.slips[i]);
};
