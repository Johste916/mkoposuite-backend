const express = require("express");
const ctl = require("../controllers/reportController");

const r = express.Router();

/* Filters */
r.get("/filters", ctl.getFilters);

/* Borrowers */
r.get("/borrowers/loan-summary", ctl.borrowersLoanSummary);

/* Loans (summary + disbursed register) */
r.get("/loans/summary", ctl.loansSummary);
r.get("/loans/disbursements/list", ctl.loansDisbursedList); // Disbursed loans register
r.get("/loans/export/csv", ctl.loansExportCSV);
r.get("/loans/export/pdf", ctl.loansExportPDF);
r.get("/loans/trends", ctl.loansTrends);

/* Arrears / PAR / Outstanding */
r.get("/arrears-aging", ctl.arrearsAging);
r.get("/outstanding", ctl.outstandingReport);
r.get("/par/summary", ctl.parSummary);

/* Collections */
r.get("/collections/summary", ctl.collectionsSummary);
r.get("/collectors/summary", ctl.collectorSummary);

/* Disbursements / Fees / Officers / Products */
r.get("/disbursements/summary", ctl.disbursementsSummary);
r.get("/fees/summary", ctl.feesSummary);
r.get("/loan-officers/summary", ctl.loanOfficerSummary);
r.get("/loan-products/summary", ctl.loanProductsSummary);

/* Deferred Income */
r.get("/deferred-income", ctl.deferredIncome);
r.get("/deferred-income/monthly", ctl.deferredIncomeMonthly);

/* MFRS / Daily / Monthly / Glance / Everything */
r.get("/mfrs", ctl.mfrsRatios);
r.get("/daily", ctl.dailyReport);
r.get("/monthly", ctl.monthlyReport);
r.get("/at-a-glance", ctl.atAGlance);
r.get("/all-entries", ctl.allEntries);

module.exports = r;
