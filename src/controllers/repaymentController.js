// controllers/repaymentController.js
'use strict';

const fs = require('fs');
const { Op, fn, col, literal, QueryTypes } = require('sequelize');
const {
  LoanRepayment,
  LoanPayment,
  Loan,
  Borrower,
  LoanSchedule,
  SavingsTransaction,
  Communication,
  User,
  sequelize,
} = require('../models');

const Notifier = require('../services/notifier')({ Communication, Borrower });
const Gateway = require('../services/paymentGateway')();

// ---------- Helpers ----------
const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

// ✅ Force the real table-backed model (loan_payments), ignore legacy/view models
const Repayment = LoanPayment || LoanRepayment;
const hasSavings = !!SavingsTransaction;

// ------- Table / column probing for safe queries -------
let _loanTableColumns = null; // { [colName]: true }
async function getLoanTableColumns() {
  if (_loanTableColumns) return _loanTableColumns;
  try {
    const qi = sequelize.getQueryInterface();
    const tableName = (Loan?.getTableName?.() || 'loans');
    const desc = await qi.describeTable(tableName);
    _loanTableColumns = Object.fromEntries(Object.keys(desc).map((k) => [k, true]));
  } catch {
    _loanTableColumns = {};
  }
  return _loanTableColumns;
}

function mapAttrToField(attrName) {
  const ra = Loan?.rawAttributes || {};
  const def = ra[attrName];
  if (!def) return null;
  return def.field || attrName;
}

async function pickExistingLoanAttributes(attrNames = []) {
  const cols = await getLoanTableColumns();
  const selected = [];
  for (const name of attrNames) {
    const field = mapAttrToField(name);
    if (!field) continue;
    if (cols[field]) selected.push(name);
  }
  if (!selected.includes('id') && cols['id']) selected.push('id');
  return selected.length ? selected : undefined;
}

const BORROWER_ATTRS = ['id', 'name', 'phone', 'email'];
const LOAN_BASE_ATTRS = ['id', 'borrowerId', 'currency', 'reference', 'status'];
const LOAN_AMOUNT_ATTRS = [...LOAN_BASE_ATTRS, 'amount', 'totalInterest', 'outstanding', 'totalPaid'];

// Get association alias by target model, fallback to provided default
function getAlias(sourceModel, targetModel, defaultAlias) {
  try {
    const hit = Object.values(sourceModel?.associations || {}).find((a) => a?.target === targetModel);
    return hit?.as || defaultAlias;
  } catch {
    return defaultAlias;
  }
}

// Build a consistent include tree: Repayment -> Loan (as 'loan') -> Borrower (as 'borrower') -> User (as 'loanOfficer')
async function loanInclude({ where = {}, borrowerWhere, needAmounts = false } = {}) {
  const attrsWanted = needAmounts ? LOAN_AMOUNT_ATTRS : LOAN_BASE_ATTRS;
  const safeAttrs = await pickExistingLoanAttributes(attrsWanted);

  const loanAs = getAlias(Repayment, Loan, 'loan');
  const borrowerAs = getAlias(Loan, Borrower, 'borrower');

  // nested officer on Borrower
  const officerAs = User ? getAlias(Borrower, User, 'loanOfficer') : null;

  const borrowerInclude = {
    model: Borrower,
    as: borrowerAs,
    attributes: BORROWER_ATTRS,
    ...(borrowerWhere ? { where: borrowerWhere, required: true } : { required: false }),
  };

  if (User && officerAs) {
    borrowerInclude.include = [
      {
        model: User,
        as: officerAs,
        attributes: ['id', 'name', 'firstName', 'lastName', 'email'],
        required: false,
      },
    ];
  }

  return {
    model: Loan,
    as: loanAs, // ensure included property is instance.loan
    ...(safeAttrs ? { attributes: safeAttrs } : {}),
    where,
    include: [borrowerInclude],
    required: !!(where && Object.keys(where).length) || !!borrowerWhere,
  };
}

async function loanRefSupported() {
  const cols = await getLoanTableColumns();
  return !!cols['reference'];
}

/* =============== util helpers (attr pickers) =============== */
function repaymentDateAttr() {
  const attrs = (Repayment && Repayment.rawAttributes) || {};
  if ('date' in attrs) return 'date';
  if ('paymentDate' in attrs) return 'paymentDate';
  if ('paidAt' in attrs) return 'paidAt';
  return 'createdAt';
}
function repaymentAmountAttr() {
  const attrs = (Repayment && Repayment.rawAttributes) || {};
  if ('amount' in attrs) return 'amount';
  if ('amountPaid' in attrs) return 'amountPaid';
  return null;
}
function getRepaymentDateValue(r) {
  return (
    r.date ||
    r.paymentDate ||
    r.payment_date ||
    r.paidAt ||
    r.paid_at ||
    r.createdAt ||
    null
  );
}
function getRepaymentAmountValue(r) {
  return Number(r.amount != null ? r.amount : r.amountPaid != null ? r.amountPaid : 0);
}

/* pretty name for officer */
function officerPrettyName(officer) {
  if (!officer) return null;
  const explicit =
    officer.name ||
    [officer.firstName, officer.lastName].filter(Boolean).join(' ') ||
    null;
  const titleize = (s) =>
    String(s || '')
      .replace(/[_\.\-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/\b\w/g, (c) => c.toUpperCase());

  if (explicit && /\s/.test(explicit) && !/^[a-z0-9._-]+$/i.test(explicit)) return explicit.trim();
  if (explicit && !explicit.includes('@')) return titleize(explicit);
  if (officer.email) return titleize(officer.email.split('@')[0]);
  return null;
}

/* ===== Safely update loan totals (avoid touching non-existent columns) ===== */
async function updateLoanFinancials(loan, deltaPaid, t) {
  const cols = await getLoanTableColumns();
  const updates = {};

  const totalPaidField = mapAttrToField('totalPaid');
  if (totalPaidField && cols[totalPaidField]) {
    updates.totalPaid = Math.max(0, Number(loan.totalPaid || 0) + Number(deltaPaid || 0));
  }

  const outstandingField = mapAttrToField('outstanding');
  if (outstandingField && cols[outstandingField]) {
    if (loan.outstanding != null) {
      updates.outstanding = Math.max(0, Number(loan.outstanding || 0) - Number(deltaPaid || 0));
    } else {
      const principal = Number(loan.amount || 0);
      const totalInterest = Number(loan.totalInterest || 0);
      const newTotalPaid =
        updates.totalPaid != null ? updates.totalPaid : Math.max(0, Number(loan.totalPaid || 0) + Number(deltaPaid || 0));
      updates.outstanding = Math.max(0, principal + totalInterest - newTotalPaid);
    }
  }

  if (Object.keys(updates).length) {
    await loan.update(updates, { transaction: t });
  }
}

/* ========================= receipt shape ========================= */
const shapeReceipt = (repayment, allocation = []) => {
  const totals = allocation.reduce(
    (acc, a) => ({
      principal: acc.principal + Number(a.principal || 0),
      interest: acc.interest + Number(a.interest || 0),
      fees: acc.fees + Number(a.fees || 0),
      penalties: acc.penalties + Number(a.penalties || 0),
    }),
    { principal: 0, interest: 0, fees: 0, penalties: 0 }
  );

  const loan = repayment.loan || {};
  const borrower = loan.borrower || {};

  return {
    id: repayment.id,
    receiptNo: repayment.receiptNo || `RCPT-${repayment.id}`,
    date: getRepaymentDateValue(repayment),
    amount: getRepaymentAmountValue(repayment),
    currency: repayment.currency || loan.currency || 'TZS',
    method: repayment.method || 'cash',
    reference: repayment.reference || repayment.ref || null,
    notes: repayment.notes || null,
    loan: {
      id: loan.id,
      reference: loan.reference || `L-${loan.id}`,
      borrowerName: borrower?.name || '',
    },
    postedBy: repayment.postedBy
      ? {
          name: repayment.postedByName || 'User',
          email: repayment.postedByEmail || '',
        }
      : null,
    allocation,
    totals,
  };
};

/* =========================== allocations =========================== */
async function computeAllocations({
  loanId,
  amount,
  date,
  strategy = 'oldest_due_first',
  customOrder,
  waivePenalties = false,
}) {
  if (!loanId || !Number(amount) || !LoanSchedule) {
    return {
      allocations: [],
      totals: { principal: 0, interest: 0, fees: 0, penalties: 0 },
    };
  }

  const schedule = await LoanSchedule.findAll({
    where: { loanId },
    order: [
      ['dueDate', 'ASC'],
      ['period', 'ASC'],
    ],
    raw: true,
  });

  if (!schedule.length) {
    return {
      allocations: [],
      totals: { principal: 0, interest: 0, fees: 0, penalties: 0 },
    };
  }

  const items = schedule.map((s, idx) => {
    const principalDue = Math.max(0, Number(s.principal || 0) - Number(s.principalPaid || 0));
    const interestDue = Math.max(0, Number(s.interest || 0) - Number(s.interestPaid || 0));
    const feesDue = Math.max(0, Number(s.fees || 0) - Number(s.feesPaid || 0));
    const penDue = Math.max(0, Number(s.penalties ?? s.penalty ?? 0) - Number(s.penaltiesPaid || 0));
    return {
      period: s.period ?? idx + 1,
      dueDate: s.dueDate,
      remaining: {
        principal: Number.isFinite(principalDue) ? principalDue : 0,
        interest: Number.isFinite(interestDue) ? interestDue : 0,
        fees: Number.isFinite(feesDue) ? feesDue : 0,
        penalties: waivePenalties ? 0 : Number.isFinite(penDue) ? penDue : 0,
      },
    };
  });

  let order;
  if (strategy === 'principal_first') order = ['principal', 'interest', 'fees', 'penalties'];
  else if (strategy === 'interest_first') order = ['interest', 'fees', 'penalties', 'principal'];
  else if (strategy === 'fees_first') order = ['fees', 'interest', 'penalties', 'principal'];
  else if (strategy === 'custom')
    order = String(customOrder || '')
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean);
  else order = ['penalties', 'interest', 'fees', 'principal'];

  if (waivePenalties) order = order.filter((x) => x !== 'penalties');

  let left = Number(amount);
  const allocations = [];
  const totals = { principal: 0, interest: 0, fees: 0, penalties: 0 };

  for (const it of items) {
    if (left <= 0) break;
    const line = { period: it.period, principal: 0, interest: 0, fees: 0, penalties: 0 };

    for (const cat of order) {
      if (left <= 0) break;
      const need = Math.max(0, it.remaining[cat] || 0);
      if (!need) continue;
      const take = Math.min(need, left);
      line[cat] += take;
      totals[cat] += take;
      it.remaining[cat] -= take;
      left -= take;
    }

    if (line.principal || line.interest || line.fees || line.penalties) {
      allocations.push(line);
    }
  }
  return { allocations, totals };
}

async function applyAllocationToSchedule({ loanId, allocations, asOfDate, t, sign = +1 }) {
  if (!LoanSchedule || !allocations?.length) return;

  const asOf = asOfDate ? new Date(asOfDate) : new Date();

  for (const line of allocations) {
    const row = await LoanSchedule.findOne({ where: { loanId, period: line.period }, transaction: t });
    if (!row) continue;

    const nextPrincipalPaid = r2(Number(row.principalPaid || 0) + sign * Number(line.principal || 0));
    const nextInterestPaid  = r2(Number(row.interestPaid  || 0) + sign * Number(line.interest  || 0));
    const nextFeesPaid      = r2(Number(row.feesPaid      || 0) + sign * Number(line.fees      || 0));
    const nextPensPaid      = r2(Number(row.penaltiesPaid || 0) + sign * Number(line.penalties || 0));

    const duePrincipal = r2(Number(row.principal  ?? 0));
    const dueInterest  = r2(Number(row.interest   ?? 0));
    const dueFees      = r2(Number(row.fees       ?? 0));
    const duePens      = r2(Number(row.penalties  ?? row.penalty ?? 0));

    const totalDue  = r2(duePrincipal + dueInterest + dueFees + duePens);
    const totalPaid = r2(nextPrincipalPaid + nextInterestPaid + nextFeesPaid + nextPensPaid);

    const fullySettled = totalPaid >= totalDue - 0.01;
    const status = fullySettled
      ? 'paid'
      : (row.dueDate ? new Date(row.dueDate) : asOf) < asOf
        ? 'overdue'
        : 'upcoming';

    const updateDoc = {
      principalPaid: Math.max(0, nextPrincipalPaid),
      interestPaid:  Math.max(0, nextInterestPaid),
      feesPaid:      Math.max(0, nextFeesPaid),
      penaltiesPaid: Math.max(0, nextPensPaid),
      paid:          !!fullySettled,   // boolean
      status,
      updated_at: new Date(),
    };

    await row.update(updateDoc, { transaction: t });
  }
}

/* =========================
   📥 LIST
========================== */
const getAllRepayments = async (req, res) => {
  try {
    const {
      q = '',
      loanId,
      borrowerId,
      dateFrom,
      dateTo,
      status,
      page = 1,
      pageSize = 20,
    } = req.query;

    const limit = Math.max(1, Number(pageSize));
    const offset = (Math.max(1, Number(page)) - 1) * limit;
    const dateAttr = repaymentDateAttr();

    const where = {};
    if (dateFrom || dateTo) {
      const and = {};
      if (dateFrom) and[Op.gte] = new Date(dateFrom);
      if (dateTo) and[Op.lte] = new Date(dateTo);
      where[dateAttr] = and;
    }
    if (status && (Repayment.rawAttributes || {}).status) {
      where.status = status;
    }

    const loanWhere = {};
    if (loanId) loanWhere.id = loanId;
    if (borrowerId) loanWhere.borrowerId = borrowerId;

    let borrowerWhere;
    if (q && q.trim()) {
      const needle = `%${q.trim()}%`;
      borrowerWhere = { [Op.or]: [{ name: { [Op.iLike]: needle } }, { phone: { [Op.iLike]: needle } }] };
    }

    const inc = await loanInclude({ where: loanWhere, borrowerWhere, needAmounts: false });
    if (q && q.trim()) inc.required = true;

    const { rows, count } = await Repayment.findAndCountAll({
      where,
      include: [inc],
      order: [
        [dateAttr, 'DESC'],
        ['createdAt', 'DESC'],
      ],
      limit,
      offset,
    });

    const borrowerAs = getAlias(Loan, Borrower, 'borrower');

    const filtered =
      q && q.trim()
        ? rows.filter((r) => {
            const borrower = r.loan?.[borrowerAs] || {};
            const hay = [
              borrower.name,
              borrower.phone,
              r.loan?.reference,
              r.reference,
              r.method,
              r.receiptNo,
            ]
              .filter(Boolean)
              .join(' ')
              .toLowerCase();
            return hay.includes(q.trim().toLowerCase());
          })
        : rows;

    res.json({ items: filtered, total: q ? filtered.length : count });
  } catch (err) {
    console.error('Fetch repayments error:', err);
    res.status(500).json({ error: 'Failed to fetch repayments' });
  }
};

/* ===========================
   🔍 BY BORROWER / LOAN
========================== */
const getRepaymentsByBorrower = async (req, res) => {
  try {
    const { borrowerId } = req.params;
    const dateAttr = repaymentDateAttr();

    const repayments = await Repayment.findAll({
      include: [await loanInclude({ where: { borrowerId } })],
      order: [
        [dateAttr, 'DESC'],
        ['createdAt', 'DESC'],
      ],
    });
    res.json(repayments);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error fetching borrower repayments' });
  }
};

const getRepaymentsByLoan = async (req, res) => {
  try {
    const loanId = req.params.loanId || req.params.id;
    if (!loanId) return res.status(400).json({ error: 'loanId required' });
    const dateAttr = repaymentDateAttr();

    const rows = await Repayment.findAll({
      where: { loanId },
      order: [
        [dateAttr, 'DESC'],
        ['createdAt', 'DESC'],
      ],
    });

    const items = rows.map((r) => ({
      id: r.id,
      date: getRepaymentDateValue(r),
      amount: getRepaymentAmountValue(r),
      method: r.method || '',
      ref: r.reference || r.receiptNo || '',
      postedBy: r.postedByName || r.postedByEmail || r.postedBy || '',
    }));

    res.json(items);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error fetching loan repayments' });
  }
};

const getRepaymentById = async (req, res) => {
  try {
    const { id } = req.params;
    if (!/^\d+$/.test(String(id))) {
      return res.status(400).json({ error: 'Invalid receipt id' });
    }
    const repayment = await Repayment.findByPk(id, {
      include: [await loanInclude()],
    });
    if (!repayment) return res.status(404).json({ error: 'Repayment not found' });

    const allocation = repayment.allocation || [];
    res.json(shapeReceipt(repayment, allocation));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error fetching repayment' });
  }
};

/* ===========================
   🗓️  SCHEDULE GRID
===========================*/
const listScheduleLoans = async (req, res) => {
  try {
    const {
      q = '',
      branchId,
      officerId,
      status,
      includeClosed = 'false',
      dueInDays = '30',
      page = 1,
      pageSize = 50,
    } = req.query;

    const limit = Math.max(1, Number(pageSize));
    const offset = (Math.max(1, Number(page)) - 1) * limit;

    const loanWhere = {};
    if (status) loanWhere.status = status;

    // officer is on Borrower, not Loan — handled below via nested include filter

    let borrowerWhere;
    if (q && q.trim()) {
      const needle = `%${q.trim()}%`;
      borrowerWhere = { [Op.or]: [{ name: { [Op.iLike]: needle } }, { phone: { [Op.iLike]: needle } }] };
    }

    const inc = await loanInclude({ where: loanWhere, borrowerWhere, needAmounts: false });

    // add branch filter on borrower if available
    if (branchId && Borrower?.rawAttributes?.branchId) {
      const borrowerAs = getAlias(Loan, Borrower, 'borrower');
      const borrowerInc = (inc.include || []).find((i) => i.as === borrowerAs);
      if (borrowerInc) {
        borrowerInc.where = { ...(borrowerInc.where || {}), branchId: branchId };
        borrowerInc.required = true;
      }
    }

    // add officer filter on borrower if requested
    if (officerId && User) {
      const borrowerAs = getAlias(Loan, Borrower, 'borrower');
      const officerAs = getAlias(Borrower, User, 'loanOfficer');
      const borrowerInc = (inc.include || []).find((i) => i.as === borrowerAs);
      if (borrowerInc) {
        const nested = (borrowerInc.include || []).find((i) => i.as === officerAs);
        if (nested) {
          nested.where = { ...(nested.where || {}), id: officerId };
          borrowerInc.required = true;
          nested.required = true;
        }
      }
    }

    const { rows: loans, count } = await Loan.findAndCountAll({
      ...(inc.attributes ? { attributes: inc.attributes } : {}),
      where: inc.where,
      include: inc.include,
      order: [['createdAt', 'DESC']],
      limit,
      offset,
    });

    if (!loans.length) return res.json({ items: [], total: 0, page: Number(page), limit });

    const loanIds = loans.map((l) => l.id);
    const sql = `
      SELECT loan_id,
             MIN(CASE WHEN
                 (COALESCE(principal,0)+COALESCE(interest,0)+COALESCE(fees,0)+COALESCE(penalties,0))
               > (COALESCE(principal_paid,0)+COALESCE(interest_paid,0)+COALESCE(fees_paid,0)+COALESCE(penalties_paid,0))
               THEN due_date END)                AS next_due,
             SUM( (COALESCE(principal,0)+COALESCE(interest,0)+COALESCE(fees,0)+COALESCE(penalties,0))
                 - (COALESCE(principal_paid,0)+COALESCE(interest_paid,0)+COALESCE(fees_paid,0)+COALESCE(penalties_paid,0)) ) AS outstanding
      FROM public.loan_schedules
      WHERE loan_id IN (${loanIds.map((_, i) => `$${i + 1}`).join(',')})
      GROUP BY loan_id
    `;
    const agg = await sequelize.query(sql, { type: QueryTypes.SELECT, bind: loanIds });
    const byLoanId = new Map(agg.map((r) => [Number(r.loan_id), r]));

    const borrowerAs = getAlias(Loan, Borrower, 'borrower');
    const officerAs = getAlias(Borrower, User, 'loanOfficer');

    const days = Number(dueInDays) || 30;
    const now = new Date();
    const end = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);

    const items = loans.map((l) => {
      const a = byLoanId.get(Number(l.id)) || {};
      const nextDue = a.next_due ? new Date(a.next_due) : null;
      const outstanding = Number(a.outstanding || 0);

      const borrower = l[borrowerAs] || {};
      const officer = borrower?.[officerAs];

      return {
        loanId: l.id,
        loanRef: l.reference || `L-${l.id}`,
        borrowerId: borrower.id || null,
        borrower: borrower.name || '',
        officerId: officer?.id || null,
        officer: officerPrettyName(officer) || null,
        nextDue: nextDue ? nextDue.toISOString().slice(0, 10) : null,
        outstanding,
        status: l.status || null,
        currency: l.currency || 'TZS',
      };
    });

    const withinWindow = days > 0
      ? items.filter((it) => (it.nextDue ? new Date(it.nextDue) <= end : false))
      : items;

    res.json({ items: withinWindow, total: count, page: Number(page), limit });
  } catch (err) {
    console.error('listScheduleLoans error:', err);
    res.status(500).json({ error: 'Failed to load schedule' });
  }
};

/* ===========================
   🧮 PREVIEW
========================== */
const previewAllocation = async (req, res) => {
  try {
    const { loanId, amount, date, strategy, customOrder, waivePenalties } = req.body;

    const borrowerAs = getAlias(Loan, Borrower, 'borrower');

    const loan = await Loan.findByPk(loanId, {
      attributes: await pickExistingLoanAttributes(LOAN_BASE_ATTRS),
      include: [{ model: Borrower, attributes: BORROWER_ATTRS, as: borrowerAs }],
    });
    if (!loan) return res.status(404).json({ error: 'Loan not found' });

    const result = await computeAllocations({ loanId, amount, date, strategy, customOrder, waivePenalties });
    res.json({
      ...result,
      loanCurrency: loan.currency || 'TZS',
      borrowerName: loan[borrowerAs]?.name || '',
    });
  } catch (err) {
    console.error('previewAllocation error:', err);
    res.status(500).json({ error: 'Preview allocation failed' });
  }
};

/* ===========================
   💰 CREATE (manual, immediate post)
========================== */
const createRepayment = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const role = String(req.user?.role || '').toLowerCase();
    const allowed = ['admin', 'loanofficer', 'loan_officer', 'loan-officer'];
    if (!allowed.includes(role)) {
      await t.rollback();
      return res.status(403).json({ error: 'Not permitted to create repayments' });
    }

    const {
      loanId,
      amount,
      date,
      method = 'cash',
      reference,
      notes,
      strategy,
      customOrder,
      waivePenalties = false,
      issueReceipt = true,
    } = req.body;

    if (!loanId || !Number(amount) || !date) {
      await t.rollback();
      return res.status(400).json({ error: 'loanId, amount and date are required' });
    }

    const borrowerAs = getAlias(Loan, Borrower, 'borrower');

    const loan = await Loan.findByPk(loanId, {
      attributes: await pickExistingLoanAttributes(LOAN_AMOUNT_ATTRS),
      include: [{ model: Borrower, attributes: BORROWER_ATTRS, as: borrowerAs }],
      transaction: t,
    });
    if (!loan) {
      await t.rollback();
      return res.status(404).json({ error: 'Loan not found' });
    }

    const { allocations } = await computeAllocations({
      loanId,
      amount,
      date,
      strategy,
      customOrder,
      waivePenalties,
    });

    const payload = {
      loanId,
      amountPaid: Number(amount),
      paymentDate: date,
      method,
      reference: reference || null,
      notes: notes || null,
      allocation: allocations,
      currency: loan.currency || 'TZS',
      status: 'approved',
      applied: true,
      postedBy: req.user?.id,
      postedByName: req.user?.name,
      postedByEmail: req.user?.email,
    };

    const attrs = (Repayment && Repayment.rawAttributes) || {};
    for (const k of Object.keys(payload)) if (!(k in attrs)) delete payload[k];

    const repayment = await Repayment.create(payload, { transaction: t });

    await applyAllocationToSchedule({ loanId, allocations, asOfDate: date, t, sign: +1 });
    await updateLoanFinancials(loan, +Number(amount), t);

    if (hasSavings) {
      await SavingsTransaction.create(
        {
          borrowerId: loan.borrowerId,
          amount: Number(amount),
          type: 'deposit',
          narrative: `Loan repayment deposit for ${loan.reference || loan.id}`,
          reference: payload.reference || `RCPT-${repayment.id}`,
          date,
        },
        { transaction: t }
      );
    }

    await t.commit();

    await Notifier.notifyBorrowerRepayment({
      borrower: loan[borrowerAs],
      amount: Number(amount),
      loanRef: loan.reference || loan.id,
      method,
    });

    const repFull = await Repayment.findByPk(repayment.id, { include: [await loanInclude()] });

    res.status(201).json({
      repaymentId: repayment.id,
      receipt: issueReceipt ? shapeReceipt(repFull || repayment, allocations) : undefined,
    });
  } catch (err) {
    await t.rollback();
    console.error('Create repayment error:', err);
    res.status(500).json({ error: 'Error saving repayment' });
  }
};

/* ===========================
   ✨ BULK JSON (PENDING rows)
========================== */
const createBulkRepayments = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const role = String(req.user?.role || '').toLowerCase();
    const allowed = ['admin', 'loanofficer', 'loan_officer', 'loan-officer'];
    if (!allowed.includes(role)) {
      await t.rollback();
      return res.status(403).json({ error: 'Not permitted' });
    }

    const itemsInput = Array.isArray(req.body) ? req.body : req.body?.items || req.body?.rows || [];
    const items = Array.isArray(itemsInput) ? itemsInput : [];
    if (!items.length) {
      await t.rollback();
      return res.status(400).json({ error: 'Provide an array of repayments' });
    }

    const hasRef = await loanRefSupported();
    const created = [];

    for (const it of items) {
      const {
        loanId: inLoanId,
        loanReference,
        loanRef,
        amount,
        date,
        method = 'cash',
        reference,
        notes,
      } = it;

      let loan = null;
      if (inLoanId) {
        loan = await Loan.findByPk(inLoanId, { transaction: t });
      } else if (loanReference || loanRef) {
        if (!hasRef) {
          await t.rollback();
          return res.status(409).json({ error: 'Loan reference column not available. Run the migration first.' });
        }
        loan = await Loan.findOne({ where: { reference: loanReference || loanRef }, transaction: t });
      }

      if (!loan)
        throw new Error(
          `Loan not found (loanId=${inLoanId || 'N/A'}; loanReference=${loanReference || loanRef || 'N/A'})`
        );

      const payload = {
        loanId: loan.id,
        amountPaid: Number(amount),
        paymentDate: date,
        method,
        reference: reference || null,
        notes: notes || null,
        status: 'pending',
        applied: false,
        currency: loan.currency || 'TZS',
      };
      const attrs = Repayment.rawAttributes || {};
      for (const k of Object.keys(payload)) if (!(k in attrs)) delete payload[k];

      const r = await Repayment.create(payload, { transaction: t });
      created.push(r.id);
    }

    await t.commit();
    res.status(201).json({ message: 'Bulk repayments queued for approval', ids: created });
  } catch (err) {
    await t.rollback();
    console.error('Bulk create error:', err);
    res.status(500).json({ error: err.message || 'Bulk creation failed' });
  }
};

/* ===========================
   📄 CSV UPLOAD (PENDING rows)
========================== */
const parseCsvBuffer = async (buffer) => {
  const text = buffer.toString('utf8');
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length);
  if (!lines.length) return [];
  const header = lines[0].split(',').map((h) => h.trim());
  const out = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',').map((c) => c.trim());
    const row = {};
    header.forEach((h, idx) => (row[h] = cols[idx]));
    out.push(row);
  }
  return out;
};

const uploadRepaymentsCsv = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    let buf = null;
    if (req.file?.buffer) buf = req.file.buffer;
    else if (req.file?.path) buf = fs.readFileSync(req.file.path);
    if (!buf) {
      await t.rollback();
      return res.status(400).json({ error: 'CSV file missing (field name "file")' });
    }

    const hasRef = await loanRefSupported();
    if (!hasRef) {
      await t.rollback();
      return res.status(409).json({ error: 'Loan reference column not available. Run the migration first.' });
    }

    const rows = await parseCsvBuffer(buf);
    if (!rows.length) {
      await t.rollback();
      return res.status(400).json({ error: 'CSV is empty' });
    }

    const created = [];
    for (const r of rows) {
      const lref = r.loanRef || r.loanReference || r.loan_ref || r.reference;
      const loan = await Loan.findOne({ where: { reference: lref }, transaction: t });
      if (!loan) throw new Error(`Loan not found for reference ${lref}`);

      const payload = {
        loanId: loan.id,
        amountPaid: Number(r.amount || 0),
        paymentDate: r.date,
        method: r.method || 'cash',
        reference: r.reference || null,
        notes: r.notes || null,
        status: 'pending',
        applied: false,
        currency: loan.currency || 'TZS',
      };
      const attrs = Repayment.rawAttributes || {};
      for (const k of Object.keys(payload)) if (!(k in attrs)) delete payload[k];

      const rec = await Repayment.create(payload, { transaction: t });
      created.push(rec.id);
    }

    await t.commit();
    res.status(201).json({ message: 'CSV uploaded, repayments queued for approval', ids: created });
  } catch (err) {
    await t.rollback();
    console.error('CSV upload error:', err);
    res.status(500).json({ error: err.message || 'CSV upload failed' });
  }
};

/* ===========================
   ✅ APPROVALS
========================== */
const listPendingApprovals = async (req, res) => {
  try {
    const items = await Repayment.findAll({
      where: { status: 'pending' },
      include: [await loanInclude()],
      order: [['createdAt', 'ASC']],
    });
    res.json(items);
  } catch (err) {
    console.error('listPendingApprovals error:', err);
    res.status(500).json({ error: 'Failed to fetch pending approvals' });
  }
};

const approveRepayment = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const borrowerAs = getAlias(Loan, Borrower, 'borrower');

    const repayment = await Repayment.findByPk(req.params.id, {
      include: [await loanInclude({ needAmounts: true })],
      transaction: t,
    });
    if (!repayment) {
      await t.rollback();
      return res.status(404).json({ error: 'Repayment not found' });
    }
    if (repayment.status !== 'pending') {
      await t.rollback();
      return res.status(400).json({ error: 'Repayment is not pending' });
    }

    const loan = repayment.loan;
    const date = getRepaymentDateValue(repayment) || new Date().toISOString().slice(0, 10);
    const allocations =
      repayment.allocation ||
      (await computeAllocations({ loanId: loan.id, amount: getRepaymentAmountValue(repayment), date })).allocations;

    await applyAllocationToSchedule({ loanId: loan.id, allocations, asOfDate: date, t, sign: +1 });

    const paidThis = getRepaymentAmountValue(repayment);
    await updateLoanFinancials(loan, +Number(paidThis), t);

    await repayment.update({ status: 'approved', applied: true, allocation: allocations }, { transaction: t });

    if (hasSavings) {
      await SavingsTransaction.create(
        {
          borrowerId: loan.borrowerId,
          amount: Number(paidThis),
          type: 'deposit',
          narrative: `Loan repayment deposit for ${loan.reference || loan.id}`,
          reference: repayment.reference || `RCPT-${repayment.id}`,
          date,
        },
        { transaction: t }
      );
    }

    await t.commit();

    await Notifier.notifyBorrowerRepayment({
      borrower: loan[borrowerAs],
      amount: Number(paidThis),
      loanRef: loan.reference || loan.id,
      method: repayment.method || 'cash',
    });

    res.json({ message: 'Repayment approved' });
  } catch (err) {
    await t.rollback();
    console.error('approveRepayment error:', err);
    res.status(500).json({ error: 'Approve failed' });
  }
};

const rejectRepayment = async (req, res) => {
  try {
    const repayment = await Repayment.findByPk(req.params.id);
    if (!repayment) return res.status(404).json({ error: 'Repayment not found' });
    if (repayment.status !== 'pending') return res.status(400).json({ error: 'Repayment is not pending' });

    await repayment.update({ status: 'rejected', applied: false });
    res.json({ message: 'Repayment rejected' });
  } catch (err) {
    console.error('rejectRepayment error:', err);
    res.status(500).json({ error: 'Reject failed' });
  }
};

/* ===========================
   🚫 VOID / REVERSE (applied rows)
========================== */
const voidRepayment = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const repayment = await Repayment.findByPk(req.params.id, {
      include: [await loanInclude({ needAmounts: true })],
      transaction: t,
    });
    if (!repayment) {
      await t.rollback();
      return res.status(404).json({ error: 'Repayment not found' });
    }
    if (repayment.status === 'voided') {
      await t.rollback();
      return res.status(400).json({ error: 'Already voided' });
    }

    const loan = repayment.loan;
    const date = getRepaymentDateValue(repayment) || new Date().toISOString();

    if (repayment.applied) {
      if (repayment.allocation?.length) {
        await applyAllocationToSchedule({ loanId: loan.id, allocations: repayment.allocation, asOfDate: date, t, sign: -1 });
      }
      const amt = getRepaymentAmountValue(repayment);
      await updateLoanFinancials(loan, -Number(amt || 0), t);
    }

    await repayment.update(
      { status: 'voided', applied: false, voidReason: req.body?.voidReason || null },
      { transaction: t }
    );

    await t.commit();
    res.json({ message: 'Repayment voided' });
  } catch (err) {
    await t.rollback();
    console.error('Void repayment error:', err);
    res.status(500).json({ error: 'Error voiding repayment' });
  }
};

/* ===========================
   📊 REPORTS
========================== */
const getRepaymentsSummary = async (req, res) => {
  try {
    const { dateFrom, dateTo, loanId, borrowerId } = req.query;
    const dateAttr = repaymentDateAttr();
    const amtAttr = repaymentAmountAttr();
    if (!amtAttr) return res.json({ totalAmount: 0, totalCount: 0, byMethod: [] });

    const where = { status: 'approved' };
    if (dateFrom || dateTo) {
      const and = {};
      if (dateFrom) and[Op.gte] = new Date(dateFrom);
      if (dateTo) and[Op.lte] = new Date(dateTo);
      where[dateAttr] = and;
    }

    const loanWhere = {};
    if (loanId) loanWhere.id = loanId;
    if (borrowerId) loanWhere.borrowerId = borrowerId;

    const include = [await loanInclude({ where: loanWhere })];

    const totalAmount = await Repayment.sum(col(amtAttr), { where, include });
    const totalCount = await Repayment.count({ where, include });

    const byMethodRows = await Repayment.findAll({
      where,
      include,
      attributes: [
        'method',
        [fn('COUNT', col('id')), 'count'],
        [fn('SUM', col(amtAttr)), 'amount'],
      ],
      group: ['method'],
      order: [[literal('amount'), 'DESC']],
    });

    const byMethod = byMethodRows.map((r) => ({
      method: r.method || 'unknown',
      count: Number(r.get('count') || 0),
      amount: Number(r.get('amount') || 0),
    }));

    res.json({
      totalAmount: Number(totalAmount || 0),
      totalCount: Number(totalCount || 0),
      byMethod,
    });
  } catch (err) {
    console.error('Repayments summary error:', err);
    res.status(500).json({ error: 'Failed to build summary' });
  }
};

const getRepaymentsTimeSeries = async (req, res) => {
  try {
    const { dateFrom, dateTo, granularity = 'day' } = req.query;
    const dateAttr = repaymentDateAttr();
    const amtAttr = repaymentAmountAttr();
    if (!amtAttr) return res.json({ series: [] });

    const where = { status: 'approved' };
    if (dateFrom || dateTo) {
      const and = {};
      if (dateFrom) and[Op.gte] = new Date(dateFrom);
      if (dateTo) and[Op.lte] = new Date(dateTo);
      where[dateAttr] = and;
    }

    const bucketCol = fn('date_trunc', granularity, col(dateAttr));
    const rows = await Repayment.findAll({
      where,
      attributes: [[bucketCol, 'bucket'], [fn('SUM', col(amtAttr)), 'amount']],
      group: ['bucket'],
      order: [[literal('bucket'), 'ASC']],
    });

    const series = rows.map((r) => ({
      date: r.get('bucket'),
      amount: Number(r.get('amount') || 0),
    }));
    res.json({ series });
  } catch (err) {
    console.error('TimeSeries error:', err);
    res.status(500).json({ error: 'Failed to build time series' });
  }
};

/* ===========================
   📤 EXPORT CSV
========================== */
const exportRepaymentsCsv = async (req, res) => {
  try {
    const { q = '', loanId, borrowerId, dateFrom, dateTo } = req.query;
    const dateAttr = repaymentDateAttr();

    const where = {};
    if (dateFrom || dateTo) {
      const and = {};
      if (dateFrom) and[Op.gte] = new Date(dateFrom);
      if (dateTo) and[Op.lte] = new Date(dateTo);
      where[dateAttr] = and;
    }

    const loanWhere = {};
    if (loanId) loanWhere.id = loanId;
    if (borrowerId) loanWhere.borrowerId = borrowerId;

    let borrowerWhere;
    if (q && q.trim()) {
      const needle = `%${q.trim()}%`;
      borrowerWhere = { [Op.or]: [{ name: { [Op.iLike]: needle } }, { phone: { [Op.iLike]: needle } }] };
    }

    const inc = await loanInclude({ where: loanWhere, borrowerWhere });
    if (q && q.trim()) inc.required = true;

    const rows = await Repayment.findAll({
      where,
      include: [inc],
      order: [
        [dateAttr, 'DESC'],
        ['createdAt', 'DESC'],
      ],
    });

    const borrowerAs = getAlias(Loan, Borrower, 'borrower');

    const headers = [
      'ReceiptNo',
      'Date',
      'Amount',
      'Currency',
      'Method',
      'Reference',
      'Borrower',
      'LoanRef',
      'LoanId',
      'Status',
    ];
    const csvLines = [headers.join(',')];
    for (const r of rows) {
      const loan = r.loan || {};
      const br = loan[borrowerAs] || {};
      const line = [
        `"${(r.receiptNo || `RCPT-${r.id}`).replace(/"/g, '""')}"`,
        `"${(getRepaymentDateValue(r) || '').toString().slice(0, 10)}"`,
        `${getRepaymentAmountValue(r)}`,
        `"${(r.currency || loan.currency || 'TZS').replace(/"/g, '""')}"`,
        `"${(r.method || '').replace(/"/g, '""')}"`,
        `"${(r.reference || '').replace(/"/g, '""')}"`,
        `"${(br.name || '').replace(/"/g, '""')}"`,
        `"${(loan.reference || '').replace(/"/g, '""')}"`,
        `${loan.id || ''}`,
        `"${r.status || ''}"`,
      ];
      csvLines.push(line.join(','));
    }
    const csv = csvLines.join('\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="repayments.csv"`);
    res.send(csv);
  } catch (err) {
    console.error('Export repayments error:', err);
    res.status(500).json({ error: 'Failed to export repayments' });
  }
};

/* ===========================
   🔔 WEBHOOKS (mobile & bank)
========================== */
const webhookMobileMoney = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    if (!Gateway.verifySignature('mobile', req.headers, req.rawBody || req.body)) {
      await t.rollback();
      return res.status(401).json({ error: 'Invalid signature' });
    }
    const n = Gateway.normalizeWebhook('mobile', req.body);
    if (!n?.loanReference || !n.amount) {
      await t.rollback();
      return res.status(400).json({ error: 'Missing loan reference or amount' });
    }

    if (!(await loanRefSupported())) {
      await t.rollback();
      return res.status(409).json({ error: 'Loan reference column not available. Run the migration first.' });
    }

    const borrowerAs = getAlias(Loan, Borrower, 'borrower');

    const loan = await Loan.findOne({
      where: { reference: n.loanReference },
      attributes: await pickExistingLoanAttributes(LOAN_AMOUNT_ATTRS),
      include: [{ model: Borrower, attributes: BORROWER_ATTRS, as: borrowerAs }],
      transaction: t,
    });
    if (!loan) {
      await t.rollback();
      return res.status(404).json({ error: 'Loan not found' });
    }

    const { allocations } = await computeAllocations({ loanId: loan.id, amount: n.amount, date: n.paidAt });

    const repayment = await Repayment.create(
      {
        loanId: loan.id,
        amountPaid: Number(n.amount),
        paymentDate: n.paidAt?.slice(0, 10),
        method: 'mobile',
        status: 'approved',
        applied: true,
        currency: n.currency || loan.currency || 'TZS',
        gateway: n.gateway || 'mobile',
        gatewayRef: n.gatewayRef || null,
        reference: `MM-${n.gatewayRef || Date.now()}`,
        allocation: allocations,
      },
      { transaction: t }
    );

    await applyAllocationToSchedule({ loanId: loan.id, allocations, asOfDate: n.paidAt, t, sign: +1 });
    await updateLoanFinancials(loan, +Number(n.amount), t);

    if (hasSavings) {
      await SavingsTransaction.create(
        {
          borrowerId: loan.borrowerId,
          amount: Number(n.amount),
          type: 'deposit',
          narrative: `Loan repayment deposit (mobile) for ${loan.reference || loan.id}`,
          reference: repayment.reference,
          date: n.paidAt?.slice(0, 10),
        },
        { transaction: t }
      );
    }

    await t.commit();

    await Notifier.notifyBorrowerRepayment({
      borrower: loan[borrowerAs],
      amount: Number(n.amount),
      loanRef: loan.reference || loan.id,
      method: 'mobile',
    });

    res.json({ ok: true });
  } catch (err) {
    await t.rollback();
    console.error('Mobile webhook error:', err);
    res.status(500).json({ error: 'Webhook failed' });
  }
};

const webhookBank = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    if (!Gateway.verifySignature('bank', req.headers, req.rawBody || req.body)) {
      await t.rollback();
      return res.status(401).json({ error: 'Invalid signature' });
    }
    const n = Gateway.normalizeWebhook('bank', req.body);
    if (!n?.loanReference || !n.amount) {
      await t.rollback();
      return res.status(400).json({ error: 'Missing loan reference or amount' });
    }

    if (!(await loanRefSupported())) {
      await t.rollback();
      return res.status(409).json({ error: 'Loan reference column not available. Run the migration first.' });
    }

    const borrowerAs = getAlias(Loan, Borrower, 'borrower');

    const loan = await Loan.findOne({
      where: { reference: n.loanReference },
      attributes: await pickExistingLoanAttributes(LOAN_AMOUNT_ATTRS),
      include: [{ model: Borrower, attributes: BORROWER_ATTRS, as: borrowerAs }],
      transaction: t,
    });
    if (!loan) {
      await t.rollback();
      return res.status(404).json({ error: 'Loan not found' });
    }

    const { allocations } = await computeAllocations({ loanId: loan.id, amount: n.amount, date: n.paidAt });

    const repayment = await Repayment.create(
      {
        loanId: loan.id,
        amountPaid: Number(n.amount),
        paymentDate: n.paidAt?.slice(0, 10),
        method: 'bank',
        status: 'approved',
        applied: true,
        currency: n.currency || loan.currency || 'TZS',
        gateway: 'bank',
        gatewayRef: n.gatewayRef || null,
        reference: `BK-${n.gatewayRef || Date.now()}`,
        allocation: allocations,
      },
      { transaction: t }
    );

    await applyAllocationToSchedule({ loanId: loan.id, allocations, asOfDate: n.paidAt, t, sign: +1 });
    await updateLoanFinancials(loan, +Number(n.amount), t);

    if (hasSavings) {
      await SavingsTransaction.create(
        {
          borrowerId: loan.borrowerId,
          amount: Number(n.amount),
          type: 'deposit',
          narrative: `Loan repayment deposit (bank) for ${loan.reference || loan.id}`,
          reference: repayment.reference,
          date: n.paidAt?.slice(0, 10),
        },
        { transaction: t }
      );
    }

    await t.commit();

    await Notifier.notifyBorrowerRepayment({
      borrower: loan[borrowerAs],
      amount: Number(n.amount),
      loanRef: loan.reference || loan.id,
      method: 'bank',
    });

    res.json({ ok: true });
  } catch (err) {
    await t.rollback();
    console.error('Bank webhook error:', err);
    res.status(500).json({ error: 'Webhook failed' });
  }
};

/* ===========================
   ✏️ UPDATE & DELETE (compat)
========================== */
const updateRepayment = async (req, res) => {
  try {
    const repayment = await Repayment.findByPk(req.params.id);
    if (!repayment) return res.status(404).json({ error: 'Repayment not found' });

    const body = { ...req.body };
    const attrs = (Repayment && Repayment.rawAttributes) || {};
    if (body.date && !('date' in attrs)) delete body.date;
    if (body.paymentDate && !('paymentDate' in attrs)) delete body.paymentDate;
    if (body.paidAt && !('paidAt' in attrs)) delete body.paidAt;

    await repayment.update(body);
    res.json(repayment);
  } catch (err) {
    console.error('Update repayment error:', err);
    res.status(500).json({ error: 'Error updating repayment' });
  }
};

const deleteRepayment = async (req, res) => {
  return voidRepayment(req, res);
};

/* ===========================
   EXPORTS
========================== */
module.exports = {
  // core
  getAllRepayments,
  getRepaymentsByBorrower,
  getRepaymentsByLoan,
  getRepaymentById,
  previewAllocation,
  createRepayment,
  updateRepayment,
  deleteRepayment,
  // schedule
  listScheduleLoans,
  // bulk & csv
  createBulkRepayments,
  uploadRepaymentsCsv,
  // approvals
  listPendingApprovals,
  approveRepayment,
  rejectRepayment,
  // void
  voidRepayment,
  // reports
  getRepaymentsSummary,
  getRepaymentsTimeSeries,
  exportRepaymentsCsv,
  // webhooks
  webhookMobileMoney,
  webhookBank,
};
