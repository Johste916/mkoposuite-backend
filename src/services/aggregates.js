'use strict';
/**
 * Generic, model-aware recomputations that only touch columns
 * that actually exist in your schema (safe in mixed envs).
 */
const { sequelize } = require('../models');
const { Op, QueryTypes } = require('sequelize');

const M = () => sequelize.models || {};
const has = (model, key) => !!model?.rawAttributes?.[key];
const pick = (obj, keys) => keys.find(k => has(obj, k)) || null;
const isMissing = (e) => e?.original?.code === '42P01' || e?.parent?.code === '42P01';

async function recomputeLoanAggregates(loanId, tx = null) {
  const models = M();
  const Loan = models.Loan || models.Loans;
  const Rep  = models.LoanRepayment || models.LoanRepayments || models.LoanPayments;
  if (!Loan || !Rep) return;

  const loan = await Loan.findByPk(loanId, { transaction: tx });
  if (!loan) return;

  // Sum repayments for this loan, excluding voided/rejected if such columns exist
  const repWhere = { loanId: loan.id };
  if (has(Rep, 'status')) repWhere.status = { [Op.in]: ['posted', 'approved', 'completed', 'success'] };
  if (has(Rep, 'voided')) repWhere.voided = false;

  // <-- FIX: choose the correct amount column dynamically
  const amountCol =
    has(Rep, 'amountPaid') ? 'amountPaid' :
    has(Rep, 'amount')     ? 'amount'     :
    null;

  let paid = 0;
  if (amountCol) {
    const rows = await Rep.findAll({
      where: repWhere,
      attributes: [[sequelize.fn('COALESCE', sequelize.fn('SUM', sequelize.col(amountCol)), 0), 'totalPaid']],
      raw: true,
      transaction: tx,
    });
    paid = Number(rows?.[0]?.totalPaid || 0);
  }

  // Determine loan columns dynamically
  const L = Loan;
  const principalKey   = pick(L, ['principal', 'principalAmount', 'amount', 'loanAmount']);
  const feesKey        = pick(L, ['feesTotal', 'totalFees', 'fees']);
  const totalKey       = pick(L, ['totalDue', 'total', 'totalAmount']);
  const repaidKey      = pick(L, ['totalRepaid', 'amountRepaid', 'repaid']);
  const outstandingKey = pick(L, ['outstanding', 'principalOutstanding', 'balanceOutstanding', 'remainingAmount']);
  const statusKey      = pick(L, ['status', 'loanStatus']);

  const principal   = principalKey ? Number(loan[principalKey] || 0) : 0;
  const fees        = feesKey ? Number(loan[feesKey] || 0) : 0;
  const totalDue    = totalKey ? Number(loan[totalKey] || (principal + fees)) : (principal + fees);
  const outstanding = Math.max(0, totalDue - paid);

  const patch = {};
  if (repaidKey)      patch[repaidKey] = paid;
  if (outstandingKey) patch[outstandingKey] = outstanding;

  // Optional auto-close if fully paid
  if (statusKey && outstanding === 0) {
    const closedValues = ['closed', 'complete', 'completed', 'settled'];
    const current = String(loan[statusKey] || '').toLowerCase();
    if (!closedValues.includes(current)) patch[statusKey] = 'closed';
  }

  if (Object.keys(patch).length) {
    await Loan.update(patch, { where: { id: loan.id }, transaction: tx });
  }

  return { paid, outstanding, totalDue };
}

async function recomputeBorrowerAggregates(borrowerId, tx = null) {
  const models = M();
  const Loan = models.Loan || models.Loans;
  const Borrower = models.Borrower || models.Borrowers;
  if (!Loan || !Borrower) return;

  // Roll up across this borrower's loans
  const L = Loan;
  const principalKey = pick(L, ['principal', 'principalAmount', 'amount', 'loanAmount']);
  const feesKey      = pick(L, ['feesTotal', 'totalFees', 'fees']);
  const repaidKey    = pick(L, ['totalRepaid', 'amountRepaid', 'repaid']);

  const rows = await Loan.findAll({
    where: { borrowerId },
    attributes: [
      principalKey || 'id',
      feesKey || 'id',
      repaidKey || 'id',
    ],
    raw: true,
    transaction: tx,
  });

  let totPrincipal = 0, totFees = 0, totRepaid = 0;
  for (const r of rows) {
    totPrincipal += principalKey ? Number(r[principalKey] || 0) : 0;
    totFees      += feesKey ? Number(r[feesKey] || 0) : 0;
    totRepaid    += repaidKey ? Number(r[repaidKey] || 0) : 0;
  }

  const totalDue = totPrincipal + totFees;
  const totalOutstanding = Math.max(0, totalDue - totRepaid);

  const B = Borrower;
  const dueKey  = pick(B, ['totalDue', 'loansTotalDue']);
  const outKey  = pick(B, ['totalOutstanding', 'outstanding', 'loansOutstanding']);
  const paidKey = pick(B, ['totalRepaid', 'loansRepaid']);

  const patch = {};
  if (dueKey)  patch[dueKey] = totalDue;
  if (outKey)  patch[outKey] = totalOutstanding;
  if (paidKey) patch[paidKey] = totRepaid;

  if (Object.keys(patch).length) {
    await Borrower.update(patch, { where: { id: borrowerId }, transaction: tx });
  }

  return { totalDue, totalOutstanding, totRepaid };
}

/** Optional: refresh materialized views if you have them. Safe no-op if missing. */
async function refreshReportMatviews() {
  const names = (process.env.REPORT_MATVIEWS || '')
    .split(',').map(s => s.trim()).filter(Boolean);
  for (const name of names) {
    try {
      await sequelize.query(`REFRESH MATERIALIZED VIEW CONCURRENTLY ${name};`);
    } catch (e) {
      if (!isMissing(e)) console.warn('[reports] matview refresh failed:', name, e.message);
    }
  }
}

async function recomputeLoanAndBorrower(loanId, borrowerId, tx = null) {
  const out = await recomputeLoanAggregates(loanId, tx);
  if (borrowerId) await recomputeBorrowerAggregates(borrowerId, tx);
  if (process.env.REFRESH_REPORTS_ON_WRITE === '1') await refreshReportMatviews();
  return out;
}

module.exports = {
  recomputeLoanAggregates,
  recomputeBorrowerAggregates,
  recomputeLoanAndBorrower,
  refreshReportMatviews,
};
