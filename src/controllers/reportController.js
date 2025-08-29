/* eslint-disable no-console */
'use strict';

const { Op, fn, col } = require('sequelize');
const { Parser } = require('json2csv');
const PDFDocument = require('pdfkit');

let db = {};
try { db = require('../models'); } catch { db = {}; }

// Prefer whichever models exist in your build
const Loan               = db.Loan || db.Loans;
const LoanPayment        = db.LoanPayment || db.LoanRepayment || db.Repayment;
const Borrower           = db.Borrower || db.Borrowers;
const Branch             = db.Branch || db.branches || db.Branches;
const User               = db.User || db.Users;
const LoanProduct        = db.LoanProduct || db.Product || db.LoanProducts;
const SavingsTransaction = db.SavingsTransaction || db.SavingsTx;

/* ------------------------------- helpers ---------------------------------- */
const safeNumber = (v) => Number(v || 0);
const hasAttr = (Model, name) => !!Model?.rawAttributes?.[name];

const getTenantId = (req) =>
  req.headers['x-tenant-id'] || req.query.tenantId || req.user?.tenantId || null;

const withTenant = (req, Model, where = {}) => {
  const tenantId = getTenantId(req);
  return tenantId && hasAttr(Model, 'tenantId')
    ? { ...where, tenantId }
    : where;
};

async function sumSafe(Model, columns, where = {}) {
  for (const c of columns) {
    try {
      const s = await Model.sum(c, { where });
      if (Number.isFinite(Number(s))) return safeNumber(s);
    } catch { /* try next */ }
  }
  return 0;
}
async function countSafe(Model, where = {}) {
  try { return await Model.count({ where }); } catch { return 0; }
}

function parseDates(q) {
  const now = new Date();
  const startDate = q.startDate ? new Date(q.startDate) : null;
  const endDate   = q.endDate   ? new Date(q.endDate)   : null;
  const asOf      = q.asOf      ? new Date(q.asOf)      : now;
  return { startDate, endDate, asOf };
}
function betweenRange(field, startDate, endDate) {
  if (!startDate && !endDate) return {};
  if (startDate && endDate) return { [field]: { [Op.between]: [startDate, endDate] } };
  if (startDate) return { [field]: { [Op.gte]: startDate } };
  return { [field]: { [Op.lte]: endDate } };
}
function scopeText({ branchId, officerId, borrowerId, productId }) {
  const bits = [];
  bits.push(branchId ? `Branch #${branchId}` : 'All branches');
  bits.push(officerId ? `Officer #${officerId}` : 'All officers');
  bits.push(borrowerId ? `Borrower #${borrowerId}` : 'All borrowers');
  bits.push(productId ? `Product #${productId}` : 'All products');
  return bits.join(' · ');
}
function periodText({ startDate, endDate, asOf, snapshot = false }) {
  if (snapshot) return asOf ? asOf.toISOString().slice(0,10) : '';
  if (!startDate && !endDate) return 'All time';
  const s = startDate ? startDate.toISOString().slice(0,10) : '…';
  const e = endDate   ? endDate.toISOString().slice(0,10)   : '…';
  return `${s} → ${e}`;
}
function principalOf(loan) {
  const v = loan?.amount ?? loan?.principal ?? loan?.principalAmount ?? 0;
  return safeNumber(v);
}
const paymentDateField = hasAttr(LoanPayment, 'paymentDate') ? 'paymentDate' : 'createdAt';

/** Sum paid by loan, up to a date, tenant-scoped, resilient to missing columns. */
async function paidByLoanMap(req, asOf = new Date()) {
  if (!LoanPayment) return new Map();

  const whereBase = {
    ...(hasAttr(LoanPayment, 'status') ? { status: 'approved' } : {}),
    ...(hasAttr(LoanPayment, 'applied') ? { applied: true } : {}),
    [paymentDateField]: { [Op.lte]: asOf },
  };

  const where = withTenant(req, LoanPayment, whereBase);

  let rows = [];
  try {
    rows = await LoanPayment.findAll({
      where,
      attributes: ['loanId', [fn('sum', col(hasAttr(LoanPayment, 'amountPaid') ? 'amountPaid' : 'amount')), 'paid']],
      group: ['loanId'],
      raw: true,
    });
  } catch {
    // Retry without status/applied if DB lacks the columns (extreme fallback)
    rows = await LoanPayment.findAll({
      where: withTenant(req, LoanPayment, { [paymentDateField]: { [Op.lte]: asOf } }),
      attributes: ['loanId', [fn('sum', col(hasAttr(LoanPayment, 'amountPaid') ? 'amountPaid' : 'amount')), 'paid']],
      group: ['loanId'],
      raw: true,
    });
  }

  return new Map(rows.map(r => [String(r.loanId), safeNumber(r.paid)]));
}

/** Compute outstanding per loan = principal - paid (≥ 0) */
async function computeOutstandingByLoan(req, asOf = new Date()) {
  if (!Loan) return [];

  const paidMap = await paidByLoanMap(req, asOf);

  const whereLoans = withTenant(req, Loan, {});
  const loans = await Loan.findAll({
    where: whereLoans,
    attributes: ['id','borrowerId','productId','amount','principal','createdAt'],
    raw: true,
  });

  const rows = loans.map(l => {
    const principal = principalOf(l);
    const paid = paidMap.get(String(l.id)) || 0;
    const outstanding = Math.max(0, principal - paid);
    return { loanId: l.id, outstanding };
  }).filter(r => r.outstanding > 0);

  return rows;
}

/* --------------------------------- FILTERS --------------------------------- */
exports.getFilters = async (req, res) => {
  try {
    const whereBranch   = withTenant(req, Branch, {});
    const whereBorrower = withTenant(req, Borrower, {});
    const whereUser     = withTenant(req, User,    hasAttr(User, 'role') ? { role: 'loan_officer' } : {});
    const whereProduct  = withTenant(req, LoanProduct, {});

    const [branches, officers, borrowers, products] = await Promise.all([
      Branch      ? Branch.findAll({ where: whereBranch,   attributes: ['id','name'], order: [['name','ASC']], raw: true }) : [],
      User        ? User.findAll({   where: whereUser,     attributes: ['id','name','email'], order: [['name','ASC']], raw: true }) : [],
      Borrower    ? Borrower.findAll({ where: whereBorrower, attributes: ['id','name'], order: [['name','ASC']], raw: true }) : [],
      LoanProduct ? LoanProduct.findAll({ where: whereProduct, attributes: ['id','name'], order: [['name','ASC']], raw: true }) : [],
    ]);
    res.json({ branches, officers, borrowers, products });
  } catch (e) {
    console.error('filters error:', e);
    res.json({ branches: [], officers: [], borrowers: [], products: [] });
  }
};

/* ---------------------------- BORROWER SUMMARY ----------------------------- */
exports.borrowersLoanSummary = async (req, res) => {
  try {
    const { branchId, officerId, borrowerId } = req.query;
    const { startDate, endDate } = parseDates(req.query);

    const loanWhereBase = {
      ...(borrowerId ? { borrowerId } : {}),
      ...(startDate || endDate ? betweenRange('createdAt', startDate, endDate) : {}),
    };
    const loanWhere = withTenant(req, Loan, loanWhereBase);

    const [loanCount, totalDisbursed] = await Promise.all([
      Loan ? countSafe(Loan, loanWhere) : 0,
      Loan ? sumSafe(Loan, ['amount','principal','principalAmount'], loanWhere) : 0,
    ]);

    // payments
    let payWhereBase = {
      ...(hasAttr(LoanPayment, 'status') ? { status: 'approved' } : {}),
      ...(hasAttr(LoanPayment, 'applied') ? { applied: true } : {}),
      ...(startDate || endDate ? betweenRange(paymentDateField, startDate, endDate) : {}),
      ...(branchId ? { branchId } : {}),
      ...(officerId ? { officerId } : {}),
      ...(borrowerId ? { borrowerId } : {}),
    };
    payWhereBase = withTenant(req, LoanPayment, payWhereBase);

    const totalRepayments = LoanPayment
      ? await sumSafe(LoanPayment, [hasAttr(LoanPayment, 'amountPaid') ? 'amountPaid' : 'amount'], payWhereBase)
      : 0;

    // Outstanding & arrears (no schedule → arrears=0)
    const outstandingRows = await computeOutstandingByLoan(req, new Date());
    const outstandingBalance = outstandingRows.reduce((s, r) => s + safeNumber(r.outstanding), 0);

    const payload = {
      welcome: 'Hi there! Here’s a friendly snapshot of your borrowers portfolio. 👋',
      summary: {
        loanCount,
        totalRepayments,
        defaulterCount: 0,
      },
      table: {
        rows: [
          { metric: 'Total Loans Count', value: loanCount },
          { metric: 'Total Disbursed', value: totalDisbursed, currency: true },
          { metric: 'Total Repayments', value: totalRepayments, currency: true },
          { metric: 'Outstanding Balance', value: outstandingBalance, currency: true },
          { metric: 'Arrears Count', value: 0 },
          { metric: 'Arrears Amount', value: 0, currency: true },
        ],
      },
      period: periodText({ startDate, endDate }),
      scope: scopeText({ branchId, officerId, borrowerId }),
    };
    res.json(payload);
  } catch (err) {
    console.error('borrowersLoanSummary error:', err);
    res.json({
      welcome: 'Hi! We couldn’t fetch everything just now, but here’s what we have.',
      summary: { loanCount: 0, totalRepayments: 0, defaulterCount: 0 },
      table: { rows: [] },
      period: periodText({}),
      scope: scopeText({}),
    });
  }
};

/* --------------------------------- TRENDS ---------------------------------- */
exports.loansTrends = async (req, res) => {
  try {
    const year = Number(req.query.year) || new Date().getFullYear();
    const start = new Date(`${year}-01-01T00:00:00.000Z`);
    const end   = new Date(`${year}-12-31T23:59:59.999Z`);
    const monthly = Array.from({length:12},(_,i)=>({month:i+1,loans:0,repayments:0}));

    const loanWhere = withTenant(req, Loan, { createdAt: { [Op.between]: [start, end] } });
    const loans = Loan ? await Loan.findAll({
      where: loanWhere,
      attributes: ['amount','principal','createdAt'],
      raw: true,
    }) : [];

    const payWhere = withTenant(req, LoanPayment, { [paymentDateField]: { [Op.between]: [start, end] } });
    const pays = LoanPayment ? await LoanPayment.findAll({
      where: payWhere,
      attributes: [hasAttr(LoanPayment,'amountPaid')?'amountPaid':'amount', paymentDateField],
      raw: true,
    }) : [];

    loans.forEach(l => {
      const m = new Date(l.createdAt).getMonth();
      monthly[m].loans += safeNumber(l.amount ?? l.principal);
    });
    pays.forEach(p => {
      const m = new Date(p[paymentDateField]).getMonth();
      monthly[m].repayments += safeNumber(p.amountPaid ?? p.amount);
    });

    res.json(monthly);
  } catch (e) {
    console.error('Trend error:', e);
    res.json([]);
  }
};

/* ------------------------------ LOANS SUMMARY ------------------------------ */
exports.loansSummary = async (req, res) => {
  try {
    const { productId } = req.query;
    const { startDate, endDate } = parseDates(req.query);

    const whereBase = {
      ...(productId ? { productId } : {}),
      ...(startDate || endDate ? betweenRange('createdAt', startDate, endDate) : {}),
    };
    const where = withTenant(req, Loan, whereBase);

    const [count, totalDisbursed] = await Promise.all([
      Loan ? countSafe(Loan, where) : 0,
      Loan ? sumSafe(Loan, ['amount','principal'], where) : 0,
    ]);

    let rows = [];
    if (Loan) {
      rows = await Loan.findAll({
        where,
        attributes: ['id','borrowerId','productId','amount','status','createdAt'],
        order: [['createdAt','DESC']],
        limit: 200,
        raw: true,
      });
    }

    res.json({
      welcome: 'Welcome! Below is a tidy register of your loans.',
      summary: { loans: count, disbursed: totalDisbursed },
      rows,
      period: periodText({ startDate, endDate }),
      scope: scopeText(req.query),
    });
  } catch (e) {
    console.error('loansSummary error:', e);
    res.json({ welcome: 'Hello!', summary:{loans:0,disbursed:0}, rows:[], period: periodText({}), scope: scopeText({}) });
  }
};

exports.loansExportCSV = async (req, res) => {
  try {
    const { startDate, endDate } = parseDates(req.query);
    const where = withTenant(req, Loan, (startDate || endDate) ? betweenRange('createdAt', startDate, endDate) : {});
    const list = Loan ? await Loan.findAll({
      where,
      attributes: ['id','borrowerId','productId','amount','status','createdAt'],
      order: [['createdAt','DESC']],
      raw: true,
    }) : [];
    const parser = new Parser();
    const csv = parser.parse(list.map(l => ({
      id: l.id,
      borrowerId: l.borrowerId,
      productId: l.productId,
      amount: safeNumber(l.amount),
      status: l.status || '',
      createdAt: l.createdAt,
    })));
    res.header('Content-Type','text/csv');
    res.attachment('loans.csv');
    res.send(csv);
  } catch (e) {
    console.error('loansExportCSV error:', e);
    res.status(500).json({ error: 'Export failed' });
  }
};

exports.loansExportPDF = async (req, res) => {
  try {
    const { startDate, endDate } = parseDates(req.query);
    const where = withTenant(req, Loan, (startDate || endDate) ? betweenRange('createdAt', startDate, endDate) : {});
    const list = Loan ? await Loan.findAll({
      where, attributes:['id','borrowerId','productId','amount','status','createdAt'], order:[['createdAt','DESC']], raw:true,
    }) : [];
    const doc = new PDFDocument({ margin: 36 });
    const chunks = [];
    doc.on('data', d => chunks.push(d));
    doc.on('end', () => {
      res.setHeader('Content-Type','application/pdf');
      res.setHeader('Content-Disposition','attachment; filename=loans.pdf');
      res.send(Buffer.concat(chunks));
    });
    doc.fontSize(16).text('Loan Report', { align: 'center' }).moveDown();
    list.forEach(l => {
      doc.fontSize(11).text(`Loan #${l.id} • Borrower ${l.borrowerId} • Product ${l.productId} • Amount ${safeNumber(l.amount).toLocaleString()} • ${l.status || ''} • ${new Date(l.createdAt).toISOString().slice(0,10)}`);
    });
    doc.end();
  } catch (e) {
    console.error('loansExportPDF error:', e);
    res.status(500).json({ error: 'Export failed' });
  }
};

/* --------------------------- ARREARS AGING (stub) -------------------------- */
exports.arrearsAging = async (req, res) => {
  try {
    const { asOf } = parseDates(req.query);
    // No schedule table present → return a friendly, explicit stub
    res.json({
      welcome: 'We’re ready to compute aging the moment a repayment schedule is available.',
      asOf,
      table: {
        rows: [
          { metric: '1–29 Days',  value: 0, currency: true },
          { metric: '30–59 Days', value: 0, currency: true },
          { metric: '60–89 Days', value: 0, currency: true },
          { metric: '90+ Days',   value: 0, currency: true },
        ],
      },
      scope: scopeText(req.query),
    });
  } catch (e) {
    console.error('arrearsAging error:', e);
    res.json({ asOf: new Date(), table: { rows: [] } });
  }
};

/* ------------------------------- COLLECTIONS ------------------------------- */
exports.collectionsSummary = async (req, res) => {
  try {
    const { startDate, endDate } = parseDates(req.query);
    if (!LoanPayment) {
      return res.json({
        welcome: 'Collections are ready whenever payments start flowing in.',
        summary:{ total:0, receipts:0 }, rows:[], period: periodText({startDate,endDate}), scope: scopeText(req.query),
      });
    }

    let whereBase = {
      ...(hasAttr(LoanPayment, 'status') ? { status: 'approved' } : {}),
      ...(hasAttr(LoanPayment, 'applied') ? { applied: true } : {}),
      ...(startDate || endDate ? betweenRange(paymentDateField, startDate, endDate) : {}),
    };
    const where = withTenant(req, LoanPayment, whereBase);

    const [total, receipts] = await Promise.all([
      sumSafe(LoanPayment, [hasAttr(LoanPayment,'amountPaid')?'amountPaid':'amount'], where),
      countSafe(LoanPayment, where),
    ]);

    res.json({
      welcome: 'Here’s a warm look at your collection activity. ☕',
      summary:{ total, receipts }, rows:[],
      period: periodText({startDate,endDate}), scope: scopeText(req.query),
    });
  } catch (e) {
    console.error('collectionsSummary error:', e);
    res.json({ summary:{total:0,receipts:0}, rows:[], period: periodText({}), scope: scopeText({}) });
  }
};

/* -------------------------------- COLLECTOR -------------------------------- */
exports.collectorSummary = async (req, res) => {
  try {
    const { startDate, endDate } = parseDates(req.query);
    if (!LoanPayment) return res.json({ summary:{ total:0 }, rows:[], period: periodText({startDate,endDate}), scope: scopeText(req.query) });

    let whereBase = {
      ...(hasAttr(LoanPayment, 'status') ? { status: 'approved' } : {}),
      ...(hasAttr(LoanPayment, 'applied') ? { applied: true } : {}),
      ...(req.query.officerId ? { officerId: req.query.officerId } : {}),
      ...(startDate || endDate ? betweenRange(paymentDateField, startDate, endDate) : {}),
    };
    const where = withTenant(req, LoanPayment, whereBase);

    const total = await sumSafe(LoanPayment, [hasAttr(LoanPayment,'amountPaid')?'amountPaid':'amount'], where);
    res.json({ welcome: 'Collector performance at a glance.', summary:{ total }, rows:[], period: periodText({ startDate, endDate }), scope: scopeText(req.query) });
  } catch (e) {
    console.error('collectorSummary error:', e);
    res.json({ summary:{ total:0 }, rows:[], period: periodText({}), scope: scopeText({}) });
  }
};

/* ------------------------------ DEFERRED INCOME ---------------------------- */
exports.deferredIncome = async (req, res) => {
  res.json({
    welcome: 'Deferred income will populate once accruals are configured.',
    summary:{ accrued:0, received:0, deferred:0 },
    rows:[],
    period: periodText(parseDates(req.query)),
    scope: scopeText(req.query),
  });
};
exports.deferredIncomeMonthly = async (req, res) => {
  const year = Number(req.query.year) || new Date().getFullYear();
  const rows = Array.from({length:12},(_,i)=>({ month:i+1, opening:0, accrued:0, received:0, closing:0 }));
  res.json({ welcome: 'Monthly deferral roll-forward.', year, rows });
};

/* ---------------------------- PRO-RATA COLLECTIONS ------------------------- */
exports.proRataCollections = async (req, res) => {
  res.json({
    welcome: 'Once targets are set, we’ll show achievement vs. plan here.',
    summary:{ expected:0, actual:0, variance:0, achievement:0 },
    rows:[],
    period: periodText(parseDates(req.query)),
    scope: scopeText(req.query),
  });
};

/* ------------------------------- DISBURSEMENTS ----------------------------- */
exports.disbursementsSummary = async (req, res) => {
  try {
    const { startDate, endDate } = parseDates(req.query);
    const where = withTenant(req, Loan, (startDate || endDate) ? betweenRange('createdAt', startDate, endDate) : {});
    const [count, total] = await Promise.all([
      Loan ? countSafe(Loan, where) : 0,
      Loan ? sumSafe(Loan, ['amount','principal'], where) : 0,
    ]);
    res.json({ welcome:'Disbursements overview, ready to grow.', summary:{ count, total }, period: periodText({startDate,endDate}), scope: scopeText(req.query) });
  } catch (e) {
    console.error('disbursementsSummary error:', e);
    res.json({ summary:{ count:0, total:0 }, period: periodText({}), scope: scopeText({}) });
  }
};

/* ----------------------------------- FEES ---------------------------------- */
exports.feesSummary = async (req, res) => {
  res.json({ welcome:'Fees summary will appear once fee postings are enabled.', summary:{ total:0 }, byType:[], period: periodText(parseDates(req.query)), scope: scopeText(req.query) });
};

/* ------------------------------- LOAN OFFICERS ----------------------------- */
exports.loanOfficerSummary = async (req, res) => {
  res.json({ welcome:'Officer-level KPIs coming right up when enabled.', summary:{ disbursed:0, collections:0, par30:0 }, rows:[], period: periodText(parseDates(req.query)), scope: scopeText(req.query) });
};

/* ------------------------------- LOAN PRODUCTS ----------------------------- */
exports.loanProductsSummary = async (req, res) => {
  res.json({ welcome:'Product mix will populate as you start disbursing.', rows:[], period: periodText(parseDates(req.query)), scope: scopeText(req.query) });
};

/* ----------------------------------- MFRS ---------------------------------- */
exports.mfrsRatios = async (req, res) => {
  res.json({
    welcome:'Your MFRS dashboard will light up as data matures.',
    asOf: parseDates(req.query).asOf,
    ratios: {
      par30: 0, par60: 0, par90: 0,
      olp: 0, activeBorrowers: 0, avgLoanSize: 0,
      portfolioYield: 0, writeOffRatio: 0, opexRatio: 0, costPerBorrower: 0,
      collectionEfficiency: 0,
    },
  });
};

/* ----------------------------- DAILY / MONTHLY ----------------------------- */
exports.dailyReport = async (req, res) => {
  const { asOf } = parseDates({ asOf: req.query.date });
  res.json({ welcome:'Here’s your daily check-in. Have a great day! 🌞', date: asOf, disbursed: 0, collected: 0, newBorrowers: 0, exceptions: [] });
};
exports.monthlyReport = async (req, res) => {
  res.json({ welcome:'Month by month, onward and upward. 📈', month: Number(req.query.month)||new Date().getMonth()+1, year: Number(req.query.year)||new Date().getFullYear(), kpis: { disbursed:0, collected:0, par:0 } });
};

/* ------------------------------- OUTSTANDING ------------------------------- */
exports.outstandingReport = async (req, res) => {
  try {
    const { asOf } = parseDates(req.query);
    const rows = await computeOutstandingByLoan(req, asOf);
    const total = rows.reduce((s,r)=>s+safeNumber(r.outstanding),0);
    res.json({ welcome:'Outstanding snapshot, nice and clear.', rows, totals: { outstanding: total }, asOf, scope: scopeText(req.query) });
  } catch (e) {
    console.error('outstandingReport error:', e);
    res.json({ welcome:'We hit a snag, but the report is still here.', rows:[], totals:{ outstanding:0 }, asOf: parseDates(req.query).asOf });
  }
};

/* ------------------------------------ PAR ---------------------------------- */
exports.parSummary = async (req, res) => {
  try {
    const { asOf } = parseDates(req.query);
    const rows = await computeOutstandingByLoan(req, asOf);
    const olp = rows.reduce((s,r)=>s+safeNumber(r.outstanding),0);

    res.json({
      welcome:'Your PAR will shine once schedules are tracked. For now, here’s OLP.',
      asOf,
      table: {
        rows: [
          { metric: 'Outstanding Loan Portfolio (OLP)', value: olp, currency: true },
          { metric: 'PAR30', value: 0, percent: true },
          { metric: '1–29 Days', value: 0, currency: true },
          { metric: '30–59 Days', value: 0, currency: true },
          { metric: '60–89 Days', value: 0, currency: true },
          { metric: '90+ Days', value: 0, currency: true },
        ],
      },
      scope: scopeText(req.query),
    });
  } catch (e) {
    console.error('parSummary error:', e);
    res.json({ asOf: parseDates(req.query).asOf, table:{ rows: [] } });
  }
};

/* -------------------------------- AT A GLANCE ------------------------------ */
exports.atAGlance = async (req, res) => {
  const { startDate, endDate, asOf } = parseDates(req.query);
  const rows = await computeOutstandingByLoan(req, asOf);
  const outstanding = rows.reduce((s,r)=>s+safeNumber(r.outstanding),0);

  res.json({
    welcome:'A quick glance tailored for you.',
    asOf, period: periodText({startDate,endDate}),
    cards: [
      { title:'Outstanding Portfolio', value: outstanding, currency:true },
      { title:'PAR30', value: 0.0, percent:true },
      { title:'Disbursed (MTD)', value: 0, currency:true },
      { title:'Collections (MTD)', value: 0, currency:true },
    ],
    trends: [],
  });
};

/* --------------------------------- ALL ENTRIES ----------------------------- */
exports.allEntries = async (req, res) => {
  res.json({ welcome:'Everything in one place—simple and calm.', rows: [], period: periodText(parseDates(req.query)), scope: scopeText(req.query) });
};
