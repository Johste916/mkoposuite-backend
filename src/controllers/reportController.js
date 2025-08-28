// Robust reporting controller that tolerates small schema differences
// and provides scoped, date-range aware summaries.

const { Op, fn, col, literal, where } = require('sequelize');
const { Parser } = require('json2csv');
const PDFDocument = require('pdfkit');

// Models registry
const models = require('../models');
const sequelize = models.sequelize;

// Try to resolve the best repayment model available
const RepaymentModel =
  models.LoanRepayment ||
  models.LoanPayment ||
  models.Repayment ||
  null;

const Loan = models.Loan || models.Loans;
const Borrower = models.Borrower || models.Borrowers || models.Customer || null;
const Branch = models.Branch || models.branches || null;
const User = models.User || models.Users || null;

// ---------- small helpers ----------
const TABLE_NAME = (mdl, fallback) => {
  try {
    if (mdl && typeof mdl.getTableName === 'function') {
      const t = mdl.getTableName();
      return typeof t === 'string' ? t : t.tableName || fallback;
    }
  } catch {}
  return fallback;
};

const describeSafe = async (table) => {
  // Try exact name, then lowercase, then quoted variations
  const qi = sequelize.getQueryInterface();
  try {
    return await qi.describeTable(table);
  } catch {
    try {
      return await qi.describeTable(String(table).toLowerCase());
    } catch {
      try {
        return await qi.describeTable(String(table).replace(/"/g, ''));
      } catch {
        return {};
      }
    }
  }
};

const hasColumn = async (table, column) => {
  const desc = await describeSafe(table);
  return !!desc[column];
};

// prefer the first existing column name in order
const chooseColumn = async (table, candidates, fallback = null) => {
  for (const c of candidates) {
    // eslint-disable-next-line no-await-in-loop
    if (await hasColumn(table, c)) return c;
  }
  return fallback;
};

const parseDateRange = (timeRange, startDate, endDate) => {
  const now = new Date();
  const start = new Date(now);
  const end = new Date(now);

  const normalize = (d) => new Date(new Date(d).toISOString());

  if (timeRange === 'custom' && startDate && endDate) {
    return { start: normalize(startDate), end: normalize(new Date(endDate).setHours(23,59,59,999)) };
  }

  // set UTC midnight for starts
  const startOf = (d) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0));
  const endOf = (d) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 59, 59, 999));

  switch ((timeRange || '').toLowerCase()) {
    case 'today':
      return { start: startOf(now), end: endOf(now) };
    case 'week': {
      const day = now.getUTCDay() || 7;
      const s = new Date(now);
      s.setUTCDate(now.getUTCDate() - (day - 1));
      const e = new Date(s);
      e.setUTCDate(s.getUTCDate() + 6);
      return { start: startOf(s), end: endOf(e) };
    }
    case 'month': {
      const s = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
      const e = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0, 23, 59, 59, 999));
      return { start: s, end: e };
    }
    case 'quarter': {
      const q = Math.floor(now.getUTCMonth() / 3);
      const s = new Date(Date.UTC(now.getUTCFullYear(), q * 3, 1));
      const e = new Date(Date.UTC(now.getUTCFullYear(), q * 3 + 3, 0, 23, 59, 59, 999));
      return { start: s, end: e };
    }
    case 'semiannual': {
      const isH1 = now.getUTCMonth() < 6;
      const s = new Date(Date.UTC(now.getUTCFullYear(), isH1 ? 0 : 6, 1));
      const e = new Date(Date.UTC(now.getUTCFullYear(), isH1 ? 6 : 12, 0, 23, 59, 59, 999));
      return { start: s, end: e };
    }
    case 'annual': {
      const s = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
      const e = new Date(Date.UTC(now.getUTCFullYear(), 11, 31, 23, 59, 59, 999));
      return { start: s, end: e };
    }
    default:
      return { start: null, end: null }; // "All time"
  }
};

const humanScope = ({ branch, officer, borrower, timeRange, start, end }) => {
  const bits = [];
  bits.push(branch ? `Branch: ${branch}` : 'All branches');
  bits.push(officer ? `Officer: ${officer}` : 'All officers');
  bits.push(borrower ? `Borrower: ${borrower}` : 'All borrowers');

  let period = 'All time';
  if (start && end) {
    const fmt = (d) => d.toISOString().slice(0, 10);
    period = `${fmt(start)} → ${fmt(end)}`;
  } else if (timeRange) {
    period = timeRange.replace(/([A-Z])/g, ' $1').toLowerCase(); // e.g. "semiAnnual"
  }
  return { scopeLabel: bits.join(' · '), periodLabel: period };
};

// ---------- /filters ----------
exports.getFilters = async (_req, res) => {
  const out = { branches: [], officers: [], borrowers: [] };

  // Branches
  try {
    const branchTable = TABLE_NAME(Branch, 'branches');
    const rows = await sequelize.query(
      `SELECT id, name FROM ${JSON.stringify(branchTable).replace(/"/g,'"')} ORDER BY name ASC`,
      { type: sequelize.QueryTypes.SELECT }
    );
    out.branches = rows;
  } catch {
    out.branches = [];
  }

  // Officers
  try {
    const userTable = TABLE_NAME(User, '"Users"');
    const rows = await sequelize.query(
      `SELECT id, name, email FROM ${userTable}
       WHERE LOWER(COALESCE(role,'')) = 'loan_officer'
       ORDER BY name NULLS LAST, email ASC`,
      { type: sequelize.QueryTypes.SELECT }
    );
    out.officers = rows;
  } catch {
    out.officers = [];
  }

  // Borrowers
  try {
    const borrowerTable = TABLE_NAME(Borrower, '"Borrowers"');
    const rows = await sequelize.query(
      `SELECT id, name FROM ${borrowerTable} ORDER BY name ASC LIMIT 200`,
      { type: sequelize.QueryTypes.SELECT }
    );
    out.borrowers = rows;
  } catch {
    out.borrowers = [];
  }

  res.json(out);
};

// ---------- /summary ----------
exports.getSummary = async (_req, res) => {
  try {
    const loanTable = TABLE_NAME(Loan, 'loans');
    const repayTable = TABLE_NAME(RepaymentModel, 'loan_payments');

    // loans
    let loanCount = 0;
    let totalLoanAmount = 0;
    try {
      const [c, s] = await Promise.all([
        sequelize.query(`SELECT COUNT(*)::int AS c FROM ${loanTable}`, { type: sequelize.QueryTypes.SELECT }),
        sequelize.query(`SELECT COALESCE(SUM(amount),0)::bigint AS s FROM ${loanTable}`, { type: sequelize.QueryTypes.SELECT }),
      ]);
      loanCount = Number(c[0]?.c || 0);
      totalLoanAmount = Number(s[0]?.s || 0);
    } catch {}

    // repayments (tolerate either "total" or "amount" column)
    let totalRepayments = 0;
    try {
      const repAmountCol = await chooseColumn(repayTable, ['total', 'amount', 'amountPaid']);
      if (repAmountCol) {
        const rows = await sequelize.query(
          `SELECT COALESCE(SUM("${repAmountCol}"),0) AS s FROM ${repayTable} WHERE status = 'paid'`,
          { type: sequelize.QueryTypes.SELECT }
        );
        totalRepayments = Number(rows[0]?.s || 0);
      }
    } catch {}

    // defaulters count: overdue installments
    let defaulterCount = 0;
    try {
      const rows = await sequelize.query(
        `SELECT COUNT(*)::int AS c FROM ${repayTable} WHERE status != 'paid' AND "dueDate" < NOW()`,
        { type: sequelize.QueryTypes.SELECT }
      );
      defaulterCount = Number(rows[0]?.c || 0);
    } catch {}

    res.json({
      loanCount,
      totalLoanAmount,
      totalRepayments,
      totalSavings: 0, // not shown in UI currently
      defaulterCount,
    });
  } catch (err) {
    console.error('Summary error:', err);
    res.status(500).json({ error: 'Failed to load summary' });
  }
};

// ---------- /trends ----------
exports.getTrends = async (req, res) => {
  try {
    const year = Number(req.query.year) || new Date().getUTCFullYear();
    const start = new Date(Date.UTC(year, 0, 1, 0, 0, 0, 0));
    const end = new Date(Date.UTC(year, 11, 31, 23, 59, 59, 999));

    const loanTable = TABLE_NAME(Loan, 'loans');
    const repayTable = TABLE_NAME(RepaymentModel, 'loan_payments');
    const repAmountCol = await chooseColumn(repayTable, ['total', 'amount', 'amountPaid']);

    // 12 empty months
    const base = Array.from({ length: 12 }, (_, i) => ({ month: i + 1, loans: 0, repayments: 0 }));

    // loans by month
    try {
      const loanRows = await sequelize.query(
        `SELECT EXTRACT(MONTH FROM "createdAt")::int AS m, COALESCE(SUM(amount),0) AS s
           FROM ${loanTable}
          WHERE "createdAt" BETWEEN :start AND :end
          GROUP BY m`,
        { replacements: { start, end }, type: sequelize.QueryTypes.SELECT }
      );
      loanRows.forEach(r => { base[r.m - 1].loans = Number(r.s || 0); });
    } catch {}

    // repayments by month
    try {
      if (repAmountCol) {
        const repRows = await sequelize.query(
          `SELECT EXTRACT(MONTH FROM "createdAt")::int AS m, COALESCE(SUM("${repAmountCol}"),0) AS s
             FROM ${repayTable}
            WHERE "createdAt" BETWEEN :start AND :end
            GROUP BY m`,
          { replacements: { start, end }, type: sequelize.QueryTypes.SELECT }
        );
        repRows.forEach(r => { base[r.m - 1].repayments = Number(r.s || 0); });
      }
    } catch {}

    res.json(base);
  } catch (err) {
    console.error('Trend error:', err);
    res.status(500).json({ error: 'Failed to load trend data' });
  }
};

// ---------- /loan-summary (scoped) ----------
exports.getLoanSummary = async (req, res) => {
  try {
    const {
      branchId = '',
      officerId = '',
      borrowerId = '',
      timeRange = '',
      startDate = '',
      endDate = '',
    } = req.query;

    const loanTable = TABLE_NAME(Loan, 'loans');
    const repayTable = TABLE_NAME(RepaymentModel, 'loan_payments');
    const borrowerTable = TABLE_NAME(Borrower, '"Borrowers"');

    // resolve dynamic columns
    const repAmountCol = await chooseColumn(repayTable, ['total', 'amount', 'amountPaid']);
    const balanceCol = await chooseColumn(repayTable, ['balance', 'outstanding', 'remaining'], null);

    // Build WHERE fragments (raw SQL, but all values are parameterized)
    const whereLoan = [];
    const params = {};

    if (branchId) { whereLoan.push(`"${loanTable}". "branchId" = :branchId`); params.branchId = branchId; }

    // officer can be loanOfficerId or officerId; include both if present
    const hasOfficerId = await hasColumn(loanTable, 'officerId');
    const hasLoanOfficerId = await hasColumn(loanTable, 'loanOfficerId');
    if (officerId && (hasOfficerId || hasLoanOfficerId)) {
      if (hasOfficerId && hasLoanOfficerId) {
        whereLoan.push(`( "${loanTable}"."officerId" = :officerId OR "${loanTable}"."loanOfficerId" = :officerId )`);
      } else if (hasOfficerId) {
        whereLoan.push(`"${loanTable}"."officerId" = :officerId`);
      } else {
        whereLoan.push(`"${loanTable}"."loanOfficerId" = :officerId`);
      }
      params.officerId = officerId;
    }

    if (borrowerId && await hasColumn(loanTable, 'borrowerId')) {
      whereLoan.push(`"${loanTable}"."borrowerId" = :borrowerId`);
      params.borrowerId = borrowerId;
    }

    // date range (applies to both loans.createdAt and repayments.createdAt)
    const { start, end } = parseDateRange(timeRange, startDate, endDate);
    const loanDateClause = (start && end) ? ` AND "${loanTable}"."createdAt" BETWEEN :dStart AND :dEnd` : '';
    const repayDateClause = (start && end) ? ` AND "${repayTable}"."createdAt" BETWEEN :dStart AND :dEnd` : '';
    if (start && end) { params.dStart = start; params.dEnd = end; }

    const loanFilterSQL = whereLoan.length ? `WHERE ${whereLoan.join(' AND ')}` : '';

    // total loans count
    let totalLoansCount = 0;
    try {
      const rows = await sequelize.query(
        `SELECT COUNT(*)::int AS c FROM ${loanTable} ${loanFilterSQL}${loanDateClause}`,
        { replacements: params, type: sequelize.QueryTypes.SELECT }
      );
      totalLoansCount = Number(rows[0]?.c || 0);
    } catch {}

    // total disbursed
    let totalDisbursed = 0;
    try {
      const rows = await sequelize.query(
        `SELECT COALESCE(SUM(amount),0) AS s FROM ${loanTable} ${loanFilterSQL}${loanDateClause}`,
        { replacements: params, type: sequelize.QueryTypes.SELECT }
      );
      totalDisbursed = Number(rows[0]?.s || 0);
    } catch {}

    // total repayments (respect filters via loan join)
    let totalRepayments = 0;
    try {
      if (repAmountCol) {
        const rows = await sequelize.query(
          `SELECT COALESCE(SUM(r."${repAmountCol}"),0) AS s
             FROM ${repayTable} r
             JOIN ${loanTable} l ON r."loanId" = l."id"
             ${loanFilterSQL.replaceAll(`"${loanTable}"`, 'l')}
             ${repayDateClause.replaceAll(`"${repayTable}"`, 'r')}`,
          { replacements: params, type: sequelize.QueryTypes.SELECT }
        );
        totalRepayments = Number(rows[0]?.s || 0);
      }
    } catch {}

    // outstanding balance: prefer summing balance column; fallback to disbursed - repayments
    let outstandingBalance = 0;
    try {
      if (balanceCol) {
        const rows = await sequelize.query(
          `SELECT COALESCE(SUM(r."${balanceCol}"),0) AS s
             FROM ${repayTable} r
             JOIN ${loanTable} l ON r."loanId" = l."id"
             WHERE r.status != 'paid' ${repayDateClause ? repayDateClause.replace('WHERE','AND') : ''}
             ${loanFilterSQL ? ' AND ' + loanFilterSQL.replaceAll(`"${loanTable}"`, 'l').replace('WHERE ','') : ''}`,
          { replacements: params, type: sequelize.QueryTypes.SELECT }
        );
        outstandingBalance = Number(rows[0]?.s || 0);
      } else {
        outstandingBalance = Math.max(totalDisbursed - totalRepayments, 0);
      }
    } catch {
      outstandingBalance = Math.max(totalDisbursed - totalRepayments, 0);
    }

    // arrears count & amount (overdue)
    let arrearsCount = 0;
    let arrearsAmount = 0;
    try {
      const overdueEnd = end || new Date();
      const baseWhere =
        `r.status != 'paid' AND r."dueDate" < :odEnd` +
        (repayDateClause ? repayDateClause.replace('BETWEEN :dStart AND :dEnd', 'BETWEEN :dStart AND :dEnd') : '');
      const rowsC = await sequelize.query(
        `SELECT COUNT(*)::int AS c
           FROM ${repayTable} r
           JOIN ${loanTable} l ON r."loanId" = l."id"
          WHERE ${baseWhere}
          ${loanFilterSQL ? ' AND ' + loanFilterSQL.replaceAll(`"${loanTable}"`, 'l').replace('WHERE ','') : ''}`,
        { replacements: { ...params, odEnd: overdueEnd }, type: sequelize.QueryTypes.SELECT }
      );
      arrearsCount = Number(rowsC[0]?.c || 0);

      // amount use balance if exists; else sum the repayment amount for overdue items
      if (balanceCol) {
        const rowsA = await sequelize.query(
          `SELECT COALESCE(SUM(r."${balanceCol}"),0) AS s
             FROM ${repayTable} r
             JOIN ${loanTable} l ON r."loanId" = l."id"
            WHERE ${baseWhere}
            ${loanFilterSQL ? ' AND ' + loanFilterSQL.replaceAll(`"${loanTable}"`, 'l').replace('WHERE ','') : ''}`,
          { replacements: { ...params, odEnd: overdueEnd }, type: sequelize.QueryTypes.SELECT }
        );
        arrearsAmount = Number(rowsA[0]?.s || 0);
      } else if (repAmountCol) {
        const rowsA2 = await sequelize.query(
          `SELECT COALESCE(SUM(r."${repAmountCol}"),0) AS s
             FROM ${repayTable} r
             JOIN ${loanTable} l ON r."loanId" = l."id"
            WHERE ${baseWhere}
            ${loanFilterSQL ? ' AND ' + loanFilterSQL.replaceAll(`"${loanTable}"`, 'l').replace('WHERE ','') : ''}`,
          { replacements: { ...params, odEnd: overdueEnd }, type: sequelize.QueryTypes.SELECT }
        );
        arrearsAmount = Number(rowsA2[0]?.s || 0);
      }
    } catch {}

    // human labels (fixes the "scope bug")
    // Try to resolve names for the labels if IDs provided
    const resolveName = async (table, id, fallback) => {
      if (!id) return null;
      try {
        const rows = await sequelize.query(
          `SELECT name FROM ${table} WHERE id = :id LIMIT 1`,
          { replacements: { id }, type: sequelize.QueryTypes.SELECT }
        );
        return rows[0]?.name || fallback || String(id);
      } catch {
        return fallback || String(id);
      }
    };

    const branchName = branchId ? await resolveName(TABLE_NAME(Branch, 'branches'), branchId, null) : null;
    const borrowerName = borrowerId ? await resolveName(borrowerTable, borrowerId, null) : null;
    let officerName = null;
    if (officerId) {
      try {
        const userTable = TABLE_NAME(User, '"Users"');
        const rows = await sequelize.query(
          `SELECT COALESCE(NULLIF(TRIM(COALESCE(name,'')),'') , email) AS label
             FROM ${userTable} WHERE id = :id LIMIT 1`,
          { replacements: { id: officerId }, type: sequelize.QueryTypes.SELECT }
        );
        officerName = rows[0]?.label || null;
      } catch {}
    }

    const meta = humanScope({
      branch: branchName,
      officer: officerName,
      borrower: borrowerName,
      timeRange,
      start,
      end,
    });

    res.json({
      totalLoansCount,
      totalDisbursed,
      totalRepayments,
      outstandingBalance,
      arrearsCount,
      arrearsAmount,
      period: meta.periodLabel,
      scope: meta.scopeLabel,
    });
  } catch (err) {
    console.error('LoanSummary error:', err);
    res.status(500).json({ error: 'Failed to load loan summary' });
  }
};

// ---------- Exports ----------
exports.exportCSV = async (_req, res) => {
  try {
    const loanTable = TABLE_NAME(Loan, 'loans');
    const repayTable = TABLE_NAME(RepaymentModel, 'loan_payments');

    const repAmountCol = await chooseColumn(repayTable, ['total', 'amount', 'amountPaid']);
    const balanceCol = await chooseColumn(repayTable, ['balance', 'outstanding', 'remaining']);

    const rows = await sequelize.query(
      `SELECT 
          b.name AS borrower,
          r."loanId" AS "loanId",
          r."installmentNumber" AS "installment",
          r."dueDate" AS "dueDate",
          ${repAmountCol ? `r."${repAmountCol}"` : '0'} AS total,
          ${balanceCol ? `r."${balanceCol}"` : '0'} AS balance,
          r.status
        FROM ${repayTable} r
        JOIN ${loanTable} l ON r."loanId" = l."id"
        LEFT JOIN ${TABLE_NAME(Borrower, '"Borrowers"')} b ON l."borrowerId" = b.id
        ORDER BY r."dueDate" DESC NULLS LAST`,
      { type: sequelize.QueryTypes.SELECT }
    );

    const parser = new Parser();
    const csv = parser.parse(rows);

    res.header('Content-Type', 'text/csv');
    res.attachment('repayments.csv');
    res.send(csv);
  } catch (err) {
    console.error('CSV export error:', err);
    res.status(500).json({ error: 'CSV export failed' });
  }
};

exports.exportPDF = async (_req, res) => {
  try {
    const loanTable = TABLE_NAME(Loan, 'loans');
    const repayTable = TABLE_NAME(RepaymentModel, 'loan_payments');

    const repAmountCol = await chooseColumn(repayTable, ['total', 'amount', 'amountPaid']);

    const rows = await sequelize.query(
      `SELECT 
          COALESCE(b.name,'') AS borrower,
          r."loanId" AS "loanId",
          r."installmentNumber" AS "installment",
          r."dueDate" AS "dueDate",
          ${repAmountCol ? `COALESCE(r."${repAmountCol}",0)` : '0'} AS total,
          COALESCE(r.status,'') AS status
        FROM ${repayTable} r
        JOIN ${loanTable} l ON r."loanId" = l."id"
        LEFT JOIN ${TABLE_NAME(Borrower, '"Borrowers"')} b ON l."borrowerId" = b.id
        ORDER BY r."dueDate" DESC NULLS LAST`,
      { type: sequelize.QueryTypes.SELECT }
    );

    const doc = new PDFDocument({ margin: 36 });
    const chunks = [];
    doc.on('data', (d) => chunks.push(d));
    doc.on('end', () => {
      const pdf = Buffer.concat(chunks);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'attachment; filename=repayments.pdf');
      res.send(pdf);
    });

    doc.fontSize(18).text('Loan Repayment Report', { align: 'center' }).moveDown();
    rows.forEach((r) => {
      doc.fontSize(11).text(
        `Borrower: ${r.borrower || 'N/A'} | Loan #${r.loanId} | Installment: ${r.installment ?? '-'} | Due: ${r.dueDate ? new Date(r.dueDate).toISOString().slice(0,10) : '-'} | Total: ${r.total} | Status: ${r.status}`
      );
    });
    doc.end();
  } catch (err) {
    console.error('PDF export error:', err);
    res.status(500).json({ error: 'PDF export failed' });
  }
};
