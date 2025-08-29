'use strict';
const { Op } = require('sequelize');

let db = {};
try { db = require('../models'); } catch {}

const getModel = (name) => {
  const m = db?.[name] || db?.sequelize?.models?.[name];
  if (!m) throw Object.assign(new Error(`Model "${name}" not found`), { status: 500, expose: true });
  return m;
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
const money = (v) => Math.round(Number(v || 0) * 100) / 100;

const isActiveItemForPeriod = (it, period) => {
  // period: 'YYYY-MM'
  const y = Number(String(period).slice(0,4));
  const m = Number(String(period).slice(5,7));
  const start = it.startMonth ? new Date(`${it.startMonth}-01`) : null;
  const end   = it.endMonth ? new Date(`${it.endMonth}-28`) : null;
  const cur   = new Date(`${y}-${String(m).padStart(2,'0')}-15`);
  if (start && cur < start) return false;
  if (end && cur > end) return false;
  return true;
};

/* -------------------------- Items (allowance/deduction) -------------------- */
exports.listItems = async (req, res, next) => {
  try {
    const Item = getModel('PayrollItem');
    const where = { ...tenantFilter(Item, req) };
    if (req.query.employeeId) where.employeeId = req.query.employeeId;
    const rows = await Item.findAll({ where, order: [['employeeId','ASC'],['name','ASC']] });
    res.json(rows);
  } catch (e) { next(e); }
};
exports.createItem = async (req, res, next) => {
  try {
    const Item = getModel('PayrollItem');
    const rec = { ...req.body, ...tenantFilter(Item, req) };
    if (!rec.employeeId || !rec.type || !rec.name) {
      return res.status(400).json({ error: 'employeeId, type, name are required' });
    }
    const row = await Item.create(rec);
    res.status(201).json(row);
  } catch (e) { next(e); }
};
exports.updateItem = async (req, res, next) => {
  try {
    const Item = getModel('PayrollItem');
    const where = { id: req.params.id, ...tenantFilter(Item, req) };
    const row = await Item.findOne({ where });
    if (!row) return res.status(404).json({ error: 'Item not found' });
    await row.update(req.body || {});
    res.json(row);
  } catch (e) { next(e); }
};
exports.deleteItem = async (req, res, next) => {
  try {
    const Item = getModel('PayrollItem');
    const where = { id: req.params.id, ...tenantFilter(Item, req) };
    const n = await Item.destroy({ where });
    if (!n) return res.status(404).json({ error: 'Item not found' });
    res.json({ ok: true });
  } catch (e) { next(e); }
};

/* ------------------------------ Payruns & Payslips ------------------------ */
exports.listPayruns = async (req, res, next) => {
  try {
    const Payrun = getModel('Payrun');
    const where = { ...tenantFilter(Payrun, req) };
    if (req.query.period) where.period = req.query.period;
    const rows = await Payrun.findAll({ where, order: [['period','DESC'],['id','DESC']] });
    res.json(rows);
  } catch (e) { next(e); }
};

exports.generatePayrun = async (req, res, next) => {
  const t = await db.sequelize.transaction();
  try {
    const period = req.body?.period;
    if (!period || !/^\d{4}-\d{2}$/.test(period)) {
      return res.status(400).json({ error: 'period (YYYY-MM) is required' });
    }
    const Employee   = getModel('Employee');
    const Item       = getModel('PayrollItem');
    const Payrun     = getModel('Payrun');
    const Payslip    = getModel('Payslip');

    const tenantWhereEmp  = tenantFilter(Employee, req);
    const tenantWhereItem = tenantFilter(Item, req);
    const tenantWhereRun  = tenantFilter(Payrun, req);
    const tenantWhereSlip = tenantFilter(Payslip, req);

    // create/ensure payrun
    let run = await Payrun.findOne({ where: { period, ...tenantWhereRun } });
    if (!run) run = await Payrun.create({ period, status: 'draft', ...tenantWhereRun }, { transaction: t });

    // active employees
    const emps = await Employee.findAll({ where: { status: 'active', ...tenantWhereEmp }, raw: true });

    // items for those employees
    const items = await Item.findAll({ where: { employeeId: { [Op.in]: emps.map(e => e.id) }, ...tenantWhereItem }, raw: true });

    // build payslips
    for (const e of emps) {
      const eItems = items.filter(it => it.employeeId === e.id && isActiveItemForPeriod(it, period));

      const totalAllowance = eItems.filter(it => it.type === 'allowance').reduce((s, it) => s + money(it.amount), 0);
      const totalDeduction = eItems.filter(it => it.type === 'deduction').reduce((s, it) => s + money(it.amount), 0);

      const base = money(e.salaryBase || 0);
      const gross = money(base + totalAllowance);
      // simple tax stub (0 for now) — replace with your country logic later
      const tax = 0;
      const net = money(gross - totalDeduction - tax);

      const existing = await Payslip.findOne({ where: { payrunId: run.id, employeeId: e.id, ...tenantWhereSlip } });
      if (existing) {
        await existing.update({
          baseSalary: base,
          totalAllowance,
          totalDeduction,
          taxableIncome: money(gross - totalDeduction),
          tax,
          gross,
          netPay: net,
        }, { transaction: t });
      } else {
        await Payslip.create({
          payrunId: run.id,
          employeeId: e.id,
          baseSalary: base,
          totalAllowance,
          totalDeduction,
          taxableIncome: money(gross - totalDeduction),
          tax,
          gross,
          netPay: net,
          status: 'unpaid',
          ...tenantWhereSlip,
        }, { transaction: t });
      }
    }

    await t.commit();
    res.status(201).json({ ok: true, payrunId: run.id, period });
  } catch (e) {
    await t.rollback();
    next(e);
  }
};

exports.listPayslips = async (req, res, next) => {
  try {
    const Payslip = getModel('Payslip');
    const Payrun  = getModel('Payrun');
    const where = { ...tenantFilter(Payslip, req) };
    if (req.query.employeeId) where.employeeId = req.query.employeeId;
    if (req.query.period) {
      const run = await Payrun.findOne({ where: { period: req.query.period, ...tenantFilter(Payrun, req) }, raw: true });
      where.payrunId = run ? run.id : -1;
    }
    const rows = await Payslip.findAll({ where, order: [['id','DESC']] });
    res.json(rows);
  } catch (e) { next(e); }
};

exports.markPaid = async (req, res, next) => {
  try {
    const Payslip = getModel('Payslip');
    const where = { id: req.params.id, ...tenantFilter(Payslip, req) };
    const row = await Payslip.findOne({ where });
    if (!row) return res.status(404).json({ error: 'Payslip not found' });
    await row.update({ status: 'paid', paymentDate: new Date() });
    res.json(row);
  } catch (e) { next(e); }
};

exports.summary = async (req, res, next) => {
  try {
    const Payrun  = getModel('Payrun');
    const Payslip = getModel('Payslip');

    if (!req.query.period) return res.status(400).json({ error: 'period (YYYY-MM) required' });
    const run = await Payrun.findOne({ where: { period: req.query.period, ...tenantFilter(Payrun, req) } });
    if (!run) return res.json({ period: req.query.period, employees: 0, gross: 0, net: 0 });

    const slips = await Payslip.findAll({ where: { payrunId: run.id, ...tenantFilter(Payslip, req) }, raw: true });
    const gross = slips.reduce((s, p) => s + Number(p.gross || 0), 0);
    const net   = slips.reduce((s, p) => s + Number(p.netPay || 0), 0);
    res.json({ period: req.query.period, employees: slips.length, gross, net });
  } catch (e) { next(e); }
};

/* ----------------------------- Dev seed ----------------------------- */
exports.seedItems = async (_req, res, next) => {
  try {
    const Employee = getModel('Employee');
    const Item = getModel('PayrollItem');
    const emps = await Employee.findAll({ where: { status: 'active' }, raw: true });
    if (!emps.length) return res.json({ ok: true, note: 'no active employees' });
    await Item.bulkCreate([
      { employeeId: emps[0].id, type: 'allowance', name: 'Transport', amount: 50000, taxable: false, recurrence: 'monthly' },
      { employeeId: emps[0].id, type: 'deduction', name: 'Sacco', amount: 20000, taxable: false, recurrence: 'monthly' },
    ]);
    res.json({ ok: true });
  } catch (e) { next(e); }
};
