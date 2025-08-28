// src/controllers/reportController.js
const models = require('../models');
const { Op, fn, col, where: sqlWhere, literal } = require('sequelize');
const { Parser } = require('json2csv');
const PDFDocument = require('pdfkit');

/* ----------------------------- models & helpers ---------------------------- */
const Loan = models.Loan;
const Borrower = models.Borrower;
// Savings model naming tends to be stable; keep a couple fallbacks.
const SavingsTx =
  models.SavingsTransaction ||
  models.SavingTransaction ||
  models.SavingsAccountTransaction ||
  null;

// Repayments can be named differently across codebases
const Repayment =
  models.LoanRepayment ||
  models.LoanPayment ||
  models.Repayment ||
  models.LoanInstallment ||
  models.Installment ||
  null;

const sequelize = models?.sequelize;

/** Check if a model has a column */
const hasAttr = (Model, key) => !!Model?.rawAttributes && !!Model.rawAttributes[key];

/** Pick the first attribute that exists on a model */
const pickAttr = (Model, prefs, fallback = null) => {
  if (!Model?.rawAttributes) return fallback;
  for (const k of prefs) if (Model.rawAttributes[k]) return k;
  return fallback;
};

/** Resolve common field names for each model */
const FIELDS = (() => {
  const loanAmount = pickAttr(Loan, [
    'amount', 'principal', 'principalAmount', 'loanAmount', 'approvedAmount', 'disbursedAmount'
  ], 'amount');

  const loanCreatedAt = hasAttr(Loan, 'createdAt') ? 'createdAt'
                        : hasAttr(Loan, 'created_at') ? 'created_at'
                        : 'createdAt';

  const repayAmount = Repayment ? pickAttr(Repayment, [
    'total', 'amount', 'amountPaid', 'paidAmount', 'paymentAmount', 'installmentAmount'
  ], null) : null;

  const repayBalance = Repayment ? pickAttr(Repayment, [
    'balance', 'remaining', 'outstanding', 'amountDue', 'remainingBalance', 'principalOutstanding'
  ], null) : null;

  const repayDueDate = Repayment ? pickAttr(Repayment, [
    'dueDate', 'due_date', 'due_on', 'installmentDueDate'
  ], null) : null;

  const repayCreatedAt = Repayment
    ? (hasAttr(Repayment, 'createdAt') ? 'createdAt' : (hasAttr(Repayment, 'created_at') ? 'created_at' : 'createdAt'))
    : 'createdAt';

  const repayStatus = Repayment ? (hasAttr(Repayment, 'status') ? 'status' : (hasAttr(Repayment, 'isPaid') ? 'isPaid' : null)) : null;

  const repayInstallmentNo = Repayment ? pickAttr(Repayment, [
    'installmentNumber', 'installment_no', 'installment', 'sequence', 'number'
  ], null) : null;

  const repayLoanId = Repayment
    ? (hasAttr(Repayment, 'loanId') ? 'loanId' : (hasAttr(Repayment, 'loan_id') ? 'loan_id' : 'loanId'))
    : 'loanId';

  const savingsAmount = SavingsTx ? pickAttr(SavingsTx, ['amount', 'value', 'txnAmount'], 'amount') : 'amount';

  return {
    loanAmount, loanCreatedAt,
    repayAmount, repayBalance, repayDueDate, repayCreatedAt, repayStatus, repayInstallmentNo, repayLoanId,
    savingsAmount
  };
})();

/** Build a date range from UI's timeRange */
function parseRange(timeRange) {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();

  switch ((timeRange || '').trim()) {
    case 'today': {
      const s = new Date(y, m, now.getDate(), 0, 0, 0, 0);
      const e = new Date(y, m, now.getDate(), 23, 59, 59, 999);
      return { start: s, end: e };
    }
    case 'week': {
      const day = now.getDay();
      const diffToMon = (day + 6) % 7;
      const s = new Date(y, m, now.getDate() - diffToMon, 0, 0, 0, 0);
      const e = new Date(y, m, now.getDate() + (6 - diffToMon), 23, 59, 59, 999);
      return { start: s, end: e };
    }
    case 'month': {
      const s = new Date(y, m, 1, 0, 0, 0, 0);
      const e = new Date(y, m + 1, 0, 23, 59, 59, 999);
      return { start: s, end: e };
    }
    case 'quarter': {
      const qStartMonth = Math.floor(m / 3) * 3;
      const s = new Date(y, qStartMonth, 1, 0, 0, 0, 0);
      const e = new Date(y, qStartMonth + 3, 0, 23, 59, 59, 999);
      return { start: s, end: e };
    }
    case 'semiAnnual': {
      const half = m < 6 ? 0 : 6;
      const s = new Date(y, half, 1, 0, 0, 0, 0);
      const e = new Date(y, half + 6, 0, 23, 59, 59, 999);
      return { start: s, end: e };
    }
    case 'annual': {
      const s = new Date(y, 0, 1, 0, 0, 0, 0);
      const e = new Date(y, 11, 31, 23, 59, 59, 999);
      return { start: s, end: e };
    }
    default:
      return { start: null, end: null };
  }
}

const toNumber = (n) => {
  const v = Number(n);
  return Number.isFinite(v) ? v : 0;
};

const paidFilter = () => {
  if (!Repayment || !FIELDS.repayStatus) return {};
  if (FIELDS.repayStatus === 'isPaid') return { [FIELDS.repayStatus]: true };
  // assume string status column
  return { [FIELDS.repayStatus]: 'paid' };
};

const notPaidFilter = () => {
  if (!Repayment || !FIELDS.repayStatus) return {};
  if (FIELDS.repayStatus === 'isPaid') return { [FIELDS.repayStatus]: false };
  return { [FIELDS.repayStatus]: { [Op.ne]: 'paid' } };
};

/* --------------------------------- Filters --------------------------------- */
// Lightweight lists for Reports filters using raw SQL (avoids paranoid joins)
exports.getFilters = async (_req, res) => {
  try {
    if (!sequelize) return res.json({ branches: [], officers: [] });

    const [branches] = await sequelize.query('SELECT id, name FROM "public"."branches" ORDER BY name ASC;');
    const [officers] = await sequelize.query(
      'SELECT id, COALESCE(name, email) AS label FROM "public"."Users" WHERE role = :role ORDER BY label ASC;',
      { replacements: { role: 'loan_officer' } }
    );

    res.json({
      branches: Array.isArray(branches) ? branches : [],
      officers: Array.isArray(officers) ? officers.map(o => ({ id: o.id, name: o.label })) : [],
    });
  } catch (err) {
    console.error('filters error:', err);
    res.json({ branches: [], officers: [] });
  }
};

/* --------------------------------- Summary --------------------------------- */
exports.getSummary = async (_req, res) => {
  try {
    const [loanCount, totalLoanAmount] = await Promise.all([
      Loan?.count?.() ?? 0,
      Loan?.sum?.(FIELDS.loanAmount) ?? 0,
    ]);

    // repayments (paid only) — if we can detect a usable amount column
    const totalRepayments = (Repayment && FIELDS.repayAmount)
      ? (await Repayment.sum(FIELDS.repayAmount, { where: paidFilter() })) || 0
      : 0;

    // savings total
    const totalSavings = (SavingsTx && SavingsTx.sum)
      ? (await SavingsTx.sum(FIELDS.savingsAmount)) || 0
      : 0;

    // defaulter count (overdue & not paid)
    let defaulterCount = 0;
    if (Repayment && FIELDS.repayDueDate && Repayment.count) {
      defaulterCount = await Repayment.count({
        where: {
          ...notPaidFilter(),
          [FIELDS.repayDueDate]: { [Op.lt]: new Date() },
        },
      });
    }

    res.json({
      loanCount: loanCount || 0,
      totalLoanAmount: toNumber(totalLoanAmount || 0),
      totalRepayments: toNumber(totalRepayments || 0),
      totalSavings: toNumber(totalSavings || 0),
      defaulterCount: defaulterCount || 0,
    });
  } catch (err) {
    console.error('Summary error:', err);
    res.status(500).json({ error: 'Failed to load summary' });
  }
};

/* ---------------------------------- Trends --------------------------------- */
exports.getTrends = async (req, res) => {
  try {
    const year = Number(req.query.year) || new Date().getFullYear();
    const start = new Date(`${year}-01-01T00:00:00.000Z`);
    const end = new Date(`${year}-12-31T23:59:59.999Z`);

    const monthly = Array.from({ length: 12 }, (_, i) => ({
      month: i + 1,
      loans: 0,
      repayments: 0,
    }));

    const [loans, repayments] = await Promise.all([
      Loan.findAll({
        where: { [FIELDS.loanCreatedAt]: { [Op.between]: [start, end] } },
        attributes: [FIELDS.loanAmount, FIELDS.loanCreatedAt],
        raw: true,
      }),
      Repayment && FIELDS.repayAmount
        ? Repayment.findAll({
            where: { [FIELDS.repayCreatedAt]: { [Op.between]: [start, end] } },
            attributes: [FIELDS.repayAmount, FIELDS.repayCreatedAt],
            raw: true,
          })
        : Promise.resolve([]),
    ]);

    loans.forEach(l => {
      const m = new Date(l[FIELDS.loanCreatedAt]).getMonth();
      monthly[m].loans += toNumber(l[FIELDS.loanAmount]);
    });

    (repayments || []).forEach(r => {
      const m = new Date(r[FIELDS.repayCreatedAt]).getMonth();
      monthly[m].repayments += toNumber(r[FIELDS.repayAmount]);
    });

    res.json(monthly);
  } catch (err) {
    console.error('Trend error:', err);
    res.status(500).json({ error: 'Failed to load trend data' });
  }
};

/* ------------------------------- Loan Summary ------------------------------ */
exports.getLoanSummary = async (req, res) => {
  try {
    const { branchId, officerId, timeRange } = req.query || {};
    const range = parseRange(String(timeRange || '').trim());

    // WHEREs
    const loanWhere = {};
    const repaymentWhere = {};
    const borrowerWhere = {};

    if (range.start && range.end) {
      loanWhere[FIELDS.loanCreatedAt] = { [Op.between]: [range.start, range.end] };
      repaymentWhere[FIELDS.repayCreatedAt] = { [Op.between]: [range.start, range.end] };
    }

    // branch filter (prefer Loan.branchId, fallback Borrower.branchId)
    if (branchId) {
      if (hasAttr(Loan, 'branchId')) loanWhere.branchId = branchId;
      else if (hasAttr(Borrower, 'branchId')) borrowerWhere.branchId = branchId;
    }

    // officer filter (try common fields on Loan)
    if (officerId) {
      const key = ['loanOfficerId', 'officerId', 'assignedOfficerId', 'userId']
        .find(k => hasAttr(Loan, k));
      if (key) loanWhere[key] = officerId;
    }

    // sums/counts
    const [loansInScope, totalRepayments] = await Promise.all([
      Loan.findAll({ where: loanWhere, attributes: ['id', FIELDS.loanAmount], raw: true }),
      (Repayment && FIELDS.repayAmount)
        ? Repayment.sum(FIELDS.repayAmount, { where: repaymentWhere })
        : 0
    ]);

    // outstanding (non-paid)
    let outstandingBalance = 0;
    if (Repayment && FIELDS.repayBalance) {
      outstandingBalance = await Repayment.sum(FIELDS.repayBalance, {
        where: { ...repaymentWhere, ...notPaidFilter() },
      }) || 0;
    }

    // arrears (overdue & non-paid)
    let arrearsCount = 0;
    let arrearsAmount = 0;
    if (Repayment && FIELDS.repayDueDate) {
      arrearsCount = await Repayment.count({
        where: {
          ...notPaidFilter(),
          [FIELDS.repayDueDate]: { [Op.lt]: new Date() },
          ...(repaymentWhere || {}),
        },
      });

      if (FIELDS.repayBalance) {
        arrearsAmount = await Repayment.sum(FIELDS.repayBalance, {
          where: {
            ...notPaidFilter(),
            [FIELDS.repayDueDate]: { [Op.lt]: new Date() },
            ...(repaymentWhere || {}),
          },
        }) || 0;
      }
    }

    const totalDisbursed = loansInScope.reduce((acc, l) => acc + toNumber(l[FIELDS.loanAmount]), 0);
    const totalLoansCount = loansInScope.length;

    const payload = {
      totalLoansCount,
      totalDisbursed,
      totalRepayments: toNumber(totalRepayments || 0),
      outstandingBalance: toNumber(outstandingBalance || 0),
      arrearsCount: arrearsCount || 0,
      arrearsAmount: toNumber(arrearsAmount || 0),
      period: timeRange || 'all',
      scope: { branchId: branchId || null, officerId: officerId || null }
    };

    res.json(payload);
  } catch (err) {
    console.error('LoanSummary error:', err);
    res.status(500).json({ error: 'Failed to load loan summary' });
  }
};

/* ---------------------------------- Export --------------------------------- */
exports.exportCSV = async (req, res) => {
  try {
    if (!Repayment) return res.status(400).json({ error: 'Repayments model not found' });

    const { branchId, officerId, timeRange } = req.query || {};
    const range = parseRange(String(timeRange || '').trim());

    const repaymentWhere = {};
    if (range.start && range.end) {
      repaymentWhere[FIELDS.repayCreatedAt] = { [Op.between]: [range.start, range.end] };
    }

    // We try to include Loan/Borrower only if associations exist
    const include = [];
    const haveLoanAssoc = !!Repayment?.associations?.Loan;
    const haveBorrowerAssoc = !!Loan?.associations?.Borrower;

    if (haveLoanAssoc) {
      const loanWhere = {};
      if (branchId && hasAttr(Loan, 'branchId')) loanWhere.branchId = branchId;
      if (officerId) {
        const key = ['loanOfficerId', 'officerId', 'assignedOfficerId', 'userId'].find(k => hasAttr(Loan, k));
        if (key) loanWhere[key] = officerId;
      }
      const loanInc = { model: Loan, attributes: ['id', FIELDS.loanAmount], where: Object.keys(loanWhere).length ? loanWhere : undefined };
      if (haveBorrowerAssoc) {
        const bw = {};
        if (branchId && !hasAttr(Loan, 'branchId') && hasAttr(Borrower, 'branchId')) bw.branchId = branchId;
        loanInc.include = [{ model: Borrower, attributes: ['id', 'name'], where: Object.keys(bw).length ? bw : undefined, required: !!Object.keys(bw).length }];
      }
      include.push(loanInc);
    }

    const attrs = [
      FIELDS.repayLoanId,
      FIELDS.repayInstallmentNo,
      FIELDS.repayDueDate,
      FIELDS.repayAmount,
      FIELDS.repayBalance,
      FIELDS.repayStatus,
      FIELDS.repayCreatedAt
    ].filter(Boolean);

    const rows = await Repayment.findAll({
      where: repaymentWhere,
      include,
      order: [[FIELDS.repayDueDate || FIELDS.repayCreatedAt, 'DESC']],
      attributes: attrs,
    });

    const data = rows.map(r => ({
      borrower: r.Loan?.Borrower?.name || '',
      loanId: r[FIELDS.repayLoanId],
      installment: FIELDS.repayInstallmentNo ? r[FIELDS.repayInstallmentNo] : '',
      dueDate: FIELDS.repayDueDate ? r[FIELDS.repayDueDate] : null,
      total: FIELDS.repayAmount ? toNumber(r[FIELDS.repayAmount]) : 0,
      balance: FIELDS.repayBalance ? toNumber(r[FIELDS.repayBalance]) : 0,
      status: FIELDS.repayStatus ? r[FIELDS.repayStatus] : '',
      createdAt: r[FIELDS.repayCreatedAt],
    }));

    const parser = new Parser();
    const csv = parser.parse(data);

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=repayments.csv');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Report-Generated-At', new Date().toISOString());
    res.send(csv);
  } catch (err) {
    console.error('CSV export error:', err);
    res.status(500).json({ error: 'CSV export failed' });
  }
};

exports.exportPDF = async (req, res) => {
  try {
    if (!Repayment) return res.status(400).json({ error: 'Repayments model not found' });

    const { branchId, officerId, timeRange } = req.query || {};
    const range = parseRange(String(timeRange || '').trim());

    const repaymentWhere = {};
    if (range.start && range.end) {
      repaymentWhere[FIELDS.repayCreatedAt] = { [Op.between]: [range.start, range.end] };
    }

    const include = [];
    const haveLoanAssoc = !!Repayment?.associations?.Loan;
    const haveBorrowerAssoc = !!Loan?.associations?.Borrower;

    if (haveLoanAssoc) {
      const loanWhere = {};
      if (branchId && hasAttr(Loan, 'branchId')) loanWhere.branchId = branchId;
      if (officerId) {
        const key = ['loanOfficerId', 'officerId', 'assignedOfficerId', 'userId'].find(k => hasAttr(Loan, k));
        if (key) loanWhere[key] = officerId;
      }
      const loanInc = { model: Loan, attributes: ['id', FIELDS.loanAmount], where: Object.keys(loanWhere).length ? loanWhere : undefined };
      if (haveBorrowerAssoc) {
        const bw = {};
        if (branchId && !hasAttr(Loan, 'branchId') && hasAttr(Borrower, 'branchId')) bw.branchId = branchId;
        loanInc.include = [{ model: Borrower, attributes: ['id', 'name'], where: Object.keys(bw).length ? bw : undefined, required: !!Object.keys(bw).length }];
      }
      include.push(loanInc);
    }

    const attrs = [
      FIELDS.repayLoanId,
      FIELDS.repayInstallmentNo,
      FIELDS.repayDueDate,
      FIELDS.repayAmount,
      FIELDS.repayBalance,
      FIELDS.repayStatus,
      FIELDS.repayCreatedAt
    ].filter(Boolean);

    const rows = await Repayment.findAll({
      where: repaymentWhere,
      include,
      order: [[FIELDS.repayDueDate || FIELDS.repayCreatedAt, 'DESC']],
      attributes: attrs,
    });

    const doc = new PDFDocument({ margin: 36 });
    const chunks = [];
    doc.on('data', d => chunks.push(d));
    doc.on('end', () => {
      const pdf = Buffer.concat(chunks);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'attachment; filename=repayments.pdf');
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('X-Report-Generated-At', new Date().toISOString());
      res.send(pdf);
    });

    // Header
    doc.fontSize(18).text('Loan Repayment Report', { align: 'center' }).moveDown(0.5);
    const scope = [
      branchId ? `Branch: ${branchId}` : null,
      officerId ? `Officer: ${officerId}` : null,
      timeRange ? `Period: ${timeRange}` : 'Period: all'
    ].filter(Boolean).join('  •  ');
    if (scope) doc.fontSize(10).fillColor('#555').text(scope, { align: 'center' }).fillColor('#000').moveDown();

    doc.fontSize(11);
    rows.forEach(r => {
      const line = [
        `Borrower: ${r.Loan?.Borrower?.name || 'N/A'}`,
        `Loan #${r[FIELDS.repayLoanId] ?? '-'}`,
        ...(FIELDS.repayInstallmentNo ? [`Inst: ${r[FIELDS.repayInstallmentNo] ?? '-'}`] : []),
        ...(FIELDS.repayDueDate ? [`Due: ${r[FIELDS.repayDueDate] ? new Date(r[FIELDS.repayDueDate]).toISOString().slice(0,10) : '-'}`] : []),
        ...(FIELDS.repayAmount ? [`Amt: ${toNumber(r[FIELDS.repayAmount])}`] : []),
        ...(FIELDS.repayBalance ? [`Bal: ${toNumber(r[FIELDS.repayBalance])}`] : []),
        ...(FIELDS.repayStatus ? [`Status: ${r[FIELDS.repayStatus] ?? ''}`] : []),
      ].join('  |  ');
      doc.text(line);
    });

    if (!rows.length) {
      doc.moveDown().fontSize(12).text('No records for the selected filters.', { align: 'center' });
    }

    doc.end();
  } catch (err) {
    console.error('PDF export error:', err);
    res.status(500).json({ error: 'PDF export failed' });
  }
};
