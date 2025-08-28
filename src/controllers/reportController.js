// src/controllers/reportController.js
const { Loan, LoanRepayment, SavingsTransaction, Borrower } = require('../models');
const { Op } = require('sequelize');
const { Parser } = require('json2csv');
const PDFDocument = require('pdfkit');

/** ---------- utils ---------- */
const hasAttr = (Model, key) => !!Model?.rawAttributes && !!Model.rawAttributes[key];

function parseRange(timeRange) {
  const now = new Date();
  const start = new Date(0); // default: all time
  let end = new Date(now);

  if (!timeRange) return { start: null, end: null };

  const y = now.getFullYear();
  const m = now.getMonth(); // 0..11

  switch (timeRange) {
    case 'today': {
      const s = new Date(y, m, now.getDate(), 0, 0, 0, 0);
      const e = new Date(y, m, now.getDate(), 23, 59, 59, 999);
      return { start: s, end: e };
    }
    case 'week': {
      const day = now.getDay(); // 0 Sun..6 Sat
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

function buildDateWhere(field, range) {
  if (!range?.start || !range?.end) return {};
  return { [field]: { [Op.between]: [range.start, range.end] } };
}

function toNumber(n) {
  const v = Number(n);
  return Number.isFinite(v) ? v : 0;
}

/** ---------- Summary (lightweight) ---------- */
exports.getSummary = async (_req, res) => {
  try {
    const [loanCount, totalLoanAmount] = await Promise.all([
      Loan.count(),
      Loan.sum('amount'),
    ]);

    const [totalRepayments, totalSavings, defaulterCount] = await Promise.all([
      // "paid" might be your settled status; adjust if your schema differs
      LoanRepayment.sum('total', { where: { status: 'paid' } }),
      SavingsTransaction.sum('amount'),
      // count installments overdue (dueDate < now && not paid)
      LoanRepayment.count({
        where: {
          status: { [Op.ne]: 'paid' },
          dueDate: { [Op.lt]: new Date() },
        },
      }),
    ]);

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

/** ---------- Monthly trends (amount per month) ---------- */
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
      Loan.findAll({ where: { createdAt: { [Op.between]: [start, end] } }, attributes: ['amount', 'createdAt'] }),
      LoanRepayment.findAll({ where: { createdAt: { [Op.between]: [start, end] } }, attributes: ['total', 'createdAt'] }),
    ]);

    loans.forEach(l => {
      const m = new Date(l.createdAt).getMonth(); // 0..11
      monthly[m].loans += toNumber(l.amount);
    });

    repayments.forEach(r => {
      const m = new Date(r.createdAt).getMonth(); // 0..11
      monthly[m].repayments += toNumber(r.total);
    });

    res.json(monthly);
  } catch (err) {
    console.error('Trend error:', err);
    res.status(500).json({ error: 'Failed to load trend data' });
  }
};

/** ---------- Loan Summary with filters ---------- */
exports.getLoanSummary = async (req, res) => {
  try {
    const { branchId, officerId, timeRange } = req.query || {};
    const range = parseRange(String(timeRange || '').trim());

    // Build includes/where dynamically based on available attributes
    const loanWhere = {};
    const borrowerWhere = {};
    const repaymentWhere = {};

    if (range.start && range.end) {
      Object.assign(loanWhere, buildDateWhere('createdAt', range));
      Object.assign(repaymentWhere, buildDateWhere('createdAt', range));
    }

    if (branchId) {
      // Prefer Loan.branchId if exists, else Borrower.branchId
      if (hasAttr(Loan, 'branchId')) loanWhere.branchId = branchId;
      else if (hasAttr(Borrower, 'branchId')) borrowerWhere.branchId = branchId;
    }

    if (officerId) {
      // Try common officer fields
      const key = ['loanOfficerId', 'officerId', 'assignedOfficerId', 'userId']
        .find(k => hasAttr(Loan, k));
      if (key) loanWhere[key] = officerId;
    }

    const includeLoanBorrower = {
      model: Loan,
      attributes: ['id', 'amount', 'createdAt'],
      where: loanWhere,
      include: []
    };

    if (Object.keys(borrowerWhere).length) {
      includeLoanBorrower.include.push({
        model: Borrower,
        attributes: ['id', 'name'],
        where: borrowerWhere,
        required: true,
      });
    } else {
      includeLoanBorrower.include.push({
        model: Borrower,
        attributes: ['id', 'name'],
        required: false,
      });
    }

    // Queries
    const [
      loansInScope,
      repaymentsInScope,
      overdueInstallments,
      overdueAmount
    ] = await Promise.all([
      Loan.findAll({ where: loanWhere, attributes: ['id', 'amount', 'createdAt'] }),
      LoanRepayment.findAll({
        where: repaymentWhere,
        attributes: ['id', 'loanId', 'total', 'balance', 'status', 'dueDate', 'createdAt'],
        include: [includeLoanBorrower],
      }),
      LoanRepayment.count({
        where: {
          status: { [Op.ne]: 'paid' },
          dueDate: { [Op.lt]: new Date() },
        },
        include: [includeLoanBorrower],
      }),
      LoanRepayment.sum('balance', {
        where: {
          status: { [Op.ne]: 'paid' },
          dueDate: { [Op.lt]: new Date() },
        },
        include: [includeLoanBorrower],
      })
    ]);

    // Basic metrics
    const totalLoansCount   = loansInScope.length;
    const totalDisbursed    = loansInScope.reduce((acc, l) => acc + toNumber(l.amount), 0);
    const totalRepayments   = repaymentsInScope.reduce((acc, r) => acc + toNumber(r.total), 0);

    // Outstanding (approx: sum of balances for all non-paid installments in scope)
    const outstandingBalance = repaymentsInScope
      .filter(r => (r.status || '').toLowerCase() !== 'paid')
      .reduce((acc, r) => acc + toNumber(r.balance), 0);

    // Arrears (overdue only)
    const arrearsCount  = overdueInstallments || 0;
    const arrearsAmount = toNumber(overdueAmount || 0);

    const payload = {
      totalLoansCount,
      totalDisbursed,
      totalRepayments,
      outstandingBalance,
      arrearsCount,
      arrearsAmount,
      period: timeRange || 'all',
      scope: {
        branchId: branchId || null,
        officerId: officerId || null,
      }
    };

    res.json(payload);
  } catch (err) {
    console.error('LoanSummary error:', err);
    res.status(500).json({ error: 'Failed to load loan summary' });
  }
};

/** ---------- Export CSV (supports filters) ---------- */
exports.exportCSV = async (req, res) => {
  try {
    const { branchId, officerId, timeRange } = req.query || {};
    const range = parseRange(String(timeRange || '').trim());

    const loanWhere = {};
    const borrowerWhere = {};
    const repaymentWhere = {};

    if (range.start && range.end) Object.assign(repaymentWhere, buildDateWhere('createdAt', range));
    if (branchId) {
      if (hasAttr(Loan, 'branchId')) loanWhere.branchId = branchId;
      else if (hasAttr(Borrower, 'branchId')) borrowerWhere.branchId = branchId;
    }
    if (officerId) {
      const key = ['loanOfficerId', 'officerId', 'assignedOfficerId', 'userId']
        .find(k => hasAttr(Loan, k));
      if (key) loanWhere[key] = officerId;
    }

    const rows = await LoanRepayment.findAll({
      where: repaymentWhere,
      include: [{
        model: Loan,
        attributes: ['id', 'amount'],
        where: loanWhere,
        include: [{ model: Borrower, attributes: ['id', 'name', 'branchId'], where: borrowerWhere, required: !!Object.keys(borrowerWhere).length }],
        required: Object.keys(loanWhere).length > 0 || Object.keys(borrowerWhere).length > 0,
      }],
      order: [['dueDate', 'DESC']],
    });

    const data = rows.map(r => ({
      borrower: r.Loan?.Borrower?.name || '',
      branchId: r.Loan?.Borrower?.branchId ?? '',
      loanId: r.loanId,
      loanAmount: toNumber(r.Loan?.amount || 0),
      installment: r.installmentNumber,
      dueDate: r.dueDate,
      total: toNumber(r.total || 0),
      balance: toNumber(r.balance || 0),
      status: r.status || '',
      createdAt: r.createdAt,
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

/** ---------- Export PDF (supports filters) ---------- */
exports.exportPDF = async (req, res) => {
  try {
    const { branchId, officerId, timeRange } = req.query || {};
    const range = parseRange(String(timeRange || '').trim());

    const loanWhere = {};
    const borrowerWhere = {};
    const repaymentWhere = {};

    if (range.start && range.end) Object.assign(repaymentWhere, buildDateWhere('createdAt', range));
    if (branchId) {
      if (hasAttr(Loan, 'branchId')) loanWhere.branchId = branchId;
      else if (hasAttr(Borrower, 'branchId')) borrowerWhere.branchId = branchId;
    }
    if (officerId) {
      const key = ['loanOfficerId', 'officerId', 'assignedOfficerId', 'userId']
        .find(k => hasAttr(Loan, k));
      if (key) loanWhere[key] = officerId;
    }

    const rows = await LoanRepayment.findAll({
      where: repaymentWhere,
      include: [{
        model: Loan,
        attributes: ['id', 'amount'],
        where: loanWhere,
        include: [{ model: Borrower, attributes: ['id', 'name', 'branchId'], where: borrowerWhere, required: !!Object.keys(borrowerWhere).length }],
        required: Object.keys(loanWhere).length > 0 || Object.keys(borrowerWhere).length > 0,
      }],
      order: [['dueDate', 'DESC']],
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

    // Table-like listing
    doc.fontSize(11);
    rows.forEach(r => {
      const line = [
        `Borrower: ${r.Loan?.Borrower?.name || 'N/A'}`,
        `Loan #${r.loanId}`,
        `Amt: ${toNumber(r.Loan?.amount || 0)}`,
        `Inst: ${r.installmentNumber ?? '-'}`,
        `Due: ${r.dueDate ? new Date(r.dueDate).toISOString().slice(0,10) : '-'}`,
        `Total: ${toNumber(r.total || 0)}`,
        `Bal: ${toNumber(r.balance || 0)}`,
        `Status: ${r.status || ''}`
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
