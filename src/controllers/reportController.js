// server/src/controllers/reportController.js
/* eslint-disable no-console */
const { Op, fn, col, literal } = require('sequelize');

let db = {};
try { db = require('../models'); } catch (e) { db = {}; }

// Prefer whichever models exist in your build
const Loan              = db.Loan || db.Loans;
const LoanPayment       = db.LoanPayment || db.LoanRepayment || db.Repayment;
const Borrower          = db.Borrower || db.Borrowers;
const Branch            = db.Branch || db.branches || db.Branches;
const User              = db.User || db.Users;
const LoanProduct       = db.LoanProduct || db.Product || db.LoanProducts;
const SavingsTransaction= db.SavingsTransaction || db.SavingsTx;

// ---------- helpers ----------
const safeNumber = (v) => Number(v || 0);

async function sumSafe(model, columns, where = {}) {
  for (const c of columns) {
    try {
      const s = await model.sum(c, { where });
      if (Number.isFinite(Number(s))) return safeNumber(s);
    } catch { /* try next */ }
  }
  return 0;
}

// countSafe never references unknown columns
async function countSafe(model, where = {}) {
  try { return await model.count({ where }); } catch { return 0; }
}

function parseDates(q) {
  // activity reports
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

function scopeText({ branchId, officerId, borrowerId }) {
  const bits = [];
  bits.push(branchId ? `Branch #${branchId}` : 'All branches');
  bits.push(officerId ? `Officer #${officerId}` : 'All officers');
  bits.push(borrowerId ? `Borrower #${borrowerId}` : 'All borrowers');
  return bits.join(' · ');
}

function periodText({ startDate, endDate, asOf, snapshot = false }) {
  if (snapshot) return asOf ? asOf.toISOString().slice(0,10) : '';
  if (!startDate && !endDate) return 'All time';
  const s = startDate ? startDate.toISOString().slice(0,10) : '…';
  const e = endDate   ? endDate.toISOString().slice(0,10)   : '…';
  return `${s} → ${e}`;
}

// ---------- FILTERS ----------
exports.getFilters = async (req, res) => {
  try {
    const [branches, officers, borrowers, products] = await Promise.all([
      Branch ? Branch.findAll({ attributes: ['id','name'], order: [['name','ASC']], paranoid: false, raw: true }) : [],
      User   ? User.findAll({ where: { role: 'loan_officer' }, attributes: ['id','name','email'], order: [['name','ASC']], paranoid: false, raw: true }) : [],
      Borrower ? Borrower.findAll({ attributes: ['id','name'], order: [['name','ASC']], paranoid: false, raw: true }) : [],
      LoanProduct ? LoanProduct.findAll({ attributes: ['id','name'], order: [['name','ASC']], paranoid: false, raw: true }) : [],
    ]);
    res.json({ branches, officers, borrowers, products });
  } catch (e) {
    console.error('filters error:', e);
    res.json({ branches: [], officers: [], borrowers: [], products: [] });
  }
};

// ---------- BORROWERS (loan summary) ----------
exports.borrowersLoanSummary = async (req, res) => {
  try {
    const { branchId, officerId, borrowerId } = req.query;
    const { startDate, endDate } = parseDates(req.query);

    // Filters you can extend once your schema links are clear
    const loanWhere = {
      ...(borrowerId ? { borrowerId } : {}),
      ...(startDate || endDate ? betweenRange('createdAt', startDate, endDate) : {})
    };

    const [loanCount, totalDisbursed, totalRepayments] = await Promise.all([
      Loan ? countSafe(Loan, loanWhere) : 0,
      Loan ? sumSafe(Loan, ['amount','principal','principalAmount'], loanWhere) : 0,
      LoanPayment ? sumSafe(LoanPayment, ['amount','paidAmount','total'], {
        ...(startDate || endDate ? betweenRange('createdAt', startDate, endDate) : {}),
        ...(branchId ? { branchId } : {}),
        ...(officerId ? { officerId } : {})
      }) : 0,
    ]);

    // Overdues (installments not paid and past due)
    const defaulterCount = LoanPayment ? await countSafe(LoanPayment, {
      status: { [Op.ne]: 'paid' },
      dueDate: { [Op.lt]: new Date() },
      ...(branchId ? { branchId } : {}),
      ...(officerId ? { officerId } : {}),
      ...(borrowerId ? { borrowerId } : {}),
    }) : 0;

    const outstandingBalance = LoanPayment
      ? await sumSafe(LoanPayment, ['balance','remaining','amountDueRemaining','principalOutstanding'], {
          status: { [Op.ne]: 'paid' },
        })
      : 0;

    const arrearsAmount = LoanPayment
      ? await sumSafe(LoanPayment, ['balance','remaining','amountDueRemaining','principalOutstanding'], {
          status: { [Op.ne]: 'paid' },
          dueDate: { [Op.lt]: new Date() }
        })
      : 0;

    const payload = {
      summary: {
        loanCount,
        totalRepayments,
        defaulterCount
      },
      table: {
        rows: [
          { metric: 'Total Loans Count', value: loanCount },
          { metric: 'Total Disbursed', value: totalDisbursed, currency: true },
          { metric: 'Total Repayments', value: totalRepayments, currency: true },
          { metric: 'Outstanding Balance', value: outstandingBalance, currency: true },
          { metric: 'Arrears Count', value: defaulterCount },
          { metric: 'Arrears Amount', value: arrearsAmount, currency: true },
        ],
        period: periodText({ startDate, endDate }),
        scope: scopeText({ branchId, officerId, borrowerId }),
      }
    };
    res.json(payload);
  } catch (err) {
    console.error('borrowersLoanSummary error:', err);
    res.json({
      summary: { loanCount: 0, totalRepayments: 0, defaulterCount: 0 },
      table: { rows: [], period: periodText({}), scope: scopeText({}) }
    });
  }
};

// ---------- Trends (kept for back-compat) ----------
exports.loansTrends = async (req, res) => {
  try {
    const year = Number(req.query.year) || new Date().getFullYear();
    const start = new Date(`${year}-01-01T00:00:00.000Z`);
    const end   = new Date(`${year}-12-31T23:59:59.999Z`);
    const monthly = Array.from({length:12},(_,i)=>({month:i+1,loans:0,repayments:0}));

    const loans = Loan ? await Loan.findAll({
      where: { createdAt: { [Op.between]: [start, end] } },
      attributes: ['amount','createdAt']
    }) : [];

    const pays = LoanPayment ? await LoanPayment.findAll({
      where: { createdAt: { [Op.between]: [start, end] } },
      attributes: ['amount','paidAmount','createdAt']
    }) : [];

    loans.forEach(l => {
      const m = new Date(l.createdAt).getMonth();
      monthly[m].loans += safeNumber(l.amount);
    });
    pays.forEach(p => {
      const m = new Date(p.createdAt).getMonth();
      monthly[m].repayments += safeNumber(p.amount || p.paidAmount);
    });

    res.json(monthly);
  } catch (e) {
    console.error('Trend error:', e);
    res.json([]);
  }
};

// ---------- Loans summary/register ----------
exports.loansSummary = async (req, res) => {
  try {
    const { productId } = req.query;
    const { startDate, endDate } = parseDates(req.query);

    const where = {
      ...(productId ? { productId } : {}),
      ...(startDate || endDate ? betweenRange('createdAt', startDate, endDate) : {})
    };

    const [count, totalDisbursed] = await Promise.all([
      Loan ? countSafe(Loan, where) : 0,
      Loan ? sumSafe(Loan, ['amount','principal'], where) : 0,
    ]);

    // Optionally return a smaller list to display
    let rows = [];
    if (Loan) {
      rows = await Loan.findAll({
        where,
        attributes: ['id','borrowerId','productId','amount','status','createdAt'],
        order: [['createdAt','DESC']],
        limit: 200
      });
    }

    res.json({
      summary: { loans: count, disbursed: totalDisbursed },
      rows,
      period: periodText({ startDate, endDate }),
      scope: scopeText(req.query)
    });
  } catch (e) {
    console.error('loansSummary error:', e);
    res.json({ summary:{loans:0,disbursed:0}, rows:[], period: periodText({}), scope: scopeText({}) });
  }
};

const { Parser } = require('json2csv');
exports.loansExportCSV = async (req, res) => {
  try {
    const { startDate, endDate } = parseDates(req.query);
    const where = (startDate || endDate) ? betweenRange('createdAt', startDate, endDate) : {};
    const list = Loan ? await Loan.findAll({
      where,
      attributes: ['id','borrowerId','productId','amount','status','createdAt'],
      order: [['createdAt','DESC']]
    }) : [];
    const parser = new Parser();
    const csv = parser.parse(list.map(l => ({
      id: l.id,
      borrowerId: l.borrowerId,
      productId: l.productId,
      amount: safeNumber(l.amount),
      status: l.status || '',
      createdAt: l.createdAt
    })));
    res.header('Content-Type','text/csv');
    res.attachment('loans.csv');
    res.send(csv);
  } catch (e) {
    console.error('loansExportCSV error:', e);
    res.status(500).json({ error: 'Export failed' });
  }
};

const PDFDocument = require('pdfkit');
exports.loansExportPDF = async (req, res) => {
  try {
    const { startDate, endDate } = parseDates(req.query);
    const where = (startDate || endDate) ? betweenRange('createdAt', startDate, endDate) : {};
    const list = Loan ? await Loan.findAll({
      where, attributes:['id','borrowerId','productId','amount','status','createdAt'], order:[['createdAt','DESC']]
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

// ---------- Arrears aging ----------
exports.arrearsAging = async (req, res) => {
  try {
    const { asOf } = parseDates(req.query);
    const base = { status: { [Op.ne]:'paid' }, dueDate: { [Op.lt]: asOf } };
    if (!LoanPayment) return res.json({ buckets: [], asOf });

    // Pull minimal fields to compute days late
    const items = await LoanPayment.findAll({ where: base, attributes:['id','loanId','dueDate','amount','balance','remaining'] });
    const buckets = { '1-29':{count:0,amount:0}, '30-59':{count:0,amount:0}, '60-89':{count:0,amount:0}, '90+':{count:0,amount:0} };

    items.forEach(r => {
      const days = Math.floor((asOf - new Date(r.dueDate)) / (1000*60*60*24));
      const amt = safeNumber(r.balance || r.remaining || r.amount);
      const key = days>=90 ? '90+' : days>=60 ? '60-89' : days>=30 ? '30-59' : '1-29';
      buckets[key].count += 1;
      buckets[key].amount += amt;
    });

    res.json({ asOf, buckets });
  } catch (e) {
    console.error('arrearsAging error:', e);
    res.json({ asOf: new Date(), buckets: {} });
  }
};

// ---------- Collections ----------
exports.collectionsSummary = async (req, res) => {
  try {
    const { startDate, endDate } = parseDates(req.query);
    if (!LoanPayment) return res.json({ summary:{total:0,receipts:0}, rows:[], period: periodText({startDate,endDate}), scope: scopeText(req.query) });

    const where = betweenRange('createdAt', startDate, endDate);
    const [total, receipts] = await Promise.all([
      sumSafe(LoanPayment, ['amount','paidAmount','total'], where),
      countSafe(LoanPayment, where)
    ]);

    res.json({ summary:{ total, receipts }, rows:[], period: periodText({startDate,endDate}), scope: scopeText(req.query) });
  } catch (e) {
    console.error('collectionsSummary error:', e);
    res.json({ summary:{total:0,receipts:0}, rows:[], period: periodText({}), scope: scopeText({}) });
  }
};

// ---------- Collector ----------
exports.collectorSummary = async (req, res) => {
  try {
    const { startDate, endDate, officerId } = parseDates(req.query) && req.query;
    if (!LoanPayment) return res.json({ summary:{total:0}, rows:[] });
    const where = {
      ...(req.query.officerId ? { officerId: req.query.officerId } : {}),
      ...(startDate || endDate ? betweenRange('createdAt', new Date(req.query.startDate), new Date(req.query.endDate)) : {})
    };
    const total = await sumSafe(LoanPayment, ['amount','paidAmount','total'], where);
    res.json({ summary:{ total }, rows:[], period: periodText({ startDate: req.query.startDate ? new Date(req.query.startDate):null, endDate: req.query.endDate ? new Date(req.query.endDate):null }), scope: scopeText(req.query) });
  } catch (e) {
    console.error('collectorSummary error:', e);
    res.json({ summary:{ total:0 }, rows:[] });
  }
};

// ---------- Deferred income ----------
exports.deferredIncome = async (req, res) => {
  // Requires interest accrual data; return safe zeroes if not present
  res.json({ summary:{ accrued:0, received:0, deferred:0 }, rows:[], period: periodText(parseDates(req.query)), scope: scopeText(req.query) });
};
exports.deferredIncomeMonthly = async (req, res) => {
  const year = Number(req.query.year) || new Date().getFullYear();
  const rows = Array.from({length:12},(_,i)=>({ month:i+1, opening:0, accrued:0, received:0, closing:0 }));
  res.json({ year, rows });
};

// ---------- Pro-rata collections ----------
exports.proRataCollections = async (req, res) => {
  res.json({ summary:{ expected:0, actual:0, variance:0, achievement:0 }, rows:[], period: periodText(parseDates(req.query)), scope: scopeText(req.query) });
};

// ---------- Disbursements ----------
exports.disbursementsSummary = async (req, res) => {
  try {
    const { startDate, endDate } = parseDates(req.query);
    const where = (startDate || endDate) ? betweenRange('createdAt', startDate, endDate) : {};
    const [count, total] = await Promise.all([
      Loan ? countSafe(Loan, where) : 0,
      Loan ? sumSafe(Loan, ['amount','principal'], where) : 0,
    ]);
    res.json({ summary:{ count, total }, period: periodText({startDate,endDate}), scope: scopeText(req.query) });
  } catch (e) {
    console.error('disbursementsSummary error:', e);
    res.json({ summary:{ count:0, total:0 }, period: periodText({}), scope: scopeText({}) });
  }
};

// ---------- Fees ----------
exports.feesSummary = async (req, res) => {
  // If fees tracked via payments component, wire here; safe zeros for now
  res.json({ summary:{ total:0 }, byType:[], period: periodText(parseDates(req.query)), scope: scopeText(req.query) });
};

// ---------- Loan officer ----------
exports.loanOfficerSummary = async (req, res) => {
  res.json({ summary:{ disbursed:0, collections:0, par30:0 }, rows:[], period: periodText(parseDates(req.query)), scope: scopeText(req.query) });
};

// ---------- Loan products ----------
exports.loanProductsSummary = async (req, res) => {
  res.json({ rows:[], period: periodText(parseDates(req.query)), scope: scopeText(req.query) });
};

// ---------- MFRS ----------
exports.mfrsRatios = async (req, res) => {
  res.json({
    asOf: parseDates(req.query).asOf,
    ratios: {
      par30: 0, par60: 0, par90: 0,
      olp: 0, activeBorrowers: 0, avgLoanSize: 0,
      portfolioYield: 0, writeOffRatio: 0, opexRatio: 0, costPerBorrower: 0,
      collectionEfficiency: 0
    }
  });
};

// ---------- Daily / Monthly ----------
exports.dailyReport = async (req, res) => {
  const { asOf } = parseDates({ asOf: req.query.date });
  res.json({ date: asOf, disbursed: 0, collected: 0, newBorrowers: 0, exceptions: [] });
};

exports.monthlyReport = async (req, res) => {
  res.json({ month: Number(req.query.month)||new Date().getMonth()+1, year: Number(req.query.year)||new Date().getFullYear(), kpis: { disbursed:0, collected:0, par:0 } });
};

// ---------- Outstanding ----------
exports.outstandingReport = async (req, res) => {
  try {
    if (!LoanPayment) return res.json({ rows:[], totals:{ outstanding:0 }, asOf: parseDates(req.query).asOf });
    const all = await LoanPayment.findAll({
      where: { status: { [Op.ne]:'paid' } },
      attributes:['loanId','balance','remaining','amount']
    });
    const rows = {};
    all.forEach(x => {
      const amt = safeNumber(x.balance || x.remaining || x.amount);
      rows[x.loanId] = (rows[x.loanId] || 0) + amt;
    });
    const list = Object.entries(rows).map(([loanId, outstanding]) => ({ loanId, outstanding }));
    const total = list.reduce((s,r)=>s+safeNumber(r.outstanding),0);
    res.json({ rows: list, totals: { outstanding: total }, asOf: parseDates(req.query).asOf, scope: scopeText(req.query) });
  } catch (e) {
    console.error('outstandingReport error:', e);
    res.json({ rows:[], totals:{ outstanding:0 }, asOf: parseDates(req.query).asOf });
  }
};

// ---------- PAR summary ----------
exports.parSummary = async (req, res) => {
  try {
    const { asOf } = parseDates(req.query);
    if (!LoanPayment) return res.json({ asOf, par:{ olp:0, buckets:{'1-29':0,'30-59':0,'60-89':0,'90+':0}, par30:0 } });

    const items = await LoanPayment.findAll({
      attributes:['loanId','dueDate','balance','remaining','amount','status']
    });

    let olp = 0;
    const buckets = { '1-29':0, '30-59':0, '60-89':0, '90+':0 };
    items.forEach(r => {
      const outstanding = safeNumber(r.balance || r.remaining || r.amount);
      olp += outstanding;
      if (r.status === 'paid' || !r.dueDate || new Date(r.dueDate) >= asOf) return;
      const days = Math.floor((asOf - new Date(r.dueDate)) / (1000*60*60*24));
      const key = days>=90 ? '90+' : days>=60 ? '60-89' : days>=30 ? '30-59' : '1-29';
      buckets[key] += outstanding;
    });

    const par30 = olp ? ((buckets['30-59'] + buckets['60-89'] + buckets['90+']) / olp) : 0;

    res.json({ asOf, par: { olp, buckets, par30 } });
  } catch (e) {
    console.error('parSummary error:', e);
    res.json({ asOf: parseDates(req.query).asOf, par:{ olp:0, buckets:{}, par30:0 } });
  }
};

// ---------- At a glance ----------
exports.atAGlance = async (req, res) => {
  const { startDate, endDate, asOf } = parseDates(req.query);
  res.json({
    asOf, period: periodText({startDate,endDate}),
    cards: [
      { title:'Outstanding Portfolio', value:0, currency:true },
      { title:'PAR30', value:0.0, percent:true },
      { title:'Disbursed (MTD)', value:0, currency:true },
      { title:'Collections (MTD)', value:0, currency:true },
    ],
    trends: []
  });
};

// ---------- All entries ----------
exports.allEntries = async (req, res) => {
  res.json({ rows: [], period: periodText(parseDates(req.query)), scope: scopeText(req.query) });
};
