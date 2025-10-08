'use strict';

const { bus, EVENTS } = require('./syncBus');
let models;
try { models = require('../models'); } catch { try { models = require('../../models'); } catch {} }

const { recomputeLoanAndBorrower, recomputeBorrowerAggregates, refreshReportMatviews } =
  require('./aggregates');

function log(event, data) {
  const idPart = data?.id ? ` id=${data.id}` : '';
  console.log(`[sync] ${event}${idPart}`);
}

// Borrower created/updated => recompute borrower aggregates (e.g., totals)
bus.on(EVENTS.BORROWER_UPDATED, async ({ borrowerId }) => {
  log(EVENTS.BORROWER_UPDATED, { borrowerId });
  if (!borrowerId) return;
  await recomputeBorrowerAggregates(borrowerId).catch(() => {});
});

// Loan updates that affect amounts/status => recompute loan + borrower
bus.on(EVENTS.LOAN_UPDATED, async ({ loanId, borrowerId }) => {
  log(EVENTS.LOAN_UPDATED, { loanId });
  if (!loanId) return;
  await recomputeLoanAndBorrower(loanId, borrowerId).catch(() => {});
});

// Repayment posted/voided => recompute loan + borrower and refresh reports if configured
bus.on(EVENTS.REPAYMENT_POSTED, async ({ loanId, borrowerId }) => {
  log(EVENTS.REPAYMENT_POSTED, { loanId });
  if (!loanId) return;
  await recomputeLoanAndBorrower(loanId, borrowerId).catch(() => {});
});

bus.on(EVENTS.REPAYMENT_VOIDED, async ({ loanId, borrowerId }) => {
  log(EVENTS.REPAYMENT_VOIDED, { loanId });
  if (!loanId) return;
  await recomputeLoanAndBorrower(loanId, borrowerId).catch(() => {});
});

// (Optional) bump materialized views on explicit report requests
bus.on(EVENTS.REPORT_REQUESTED, async () => {
  await refreshReportMatviews().catch(() => {});
});

module.exports = bus;
