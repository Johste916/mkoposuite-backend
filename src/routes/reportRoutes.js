// server/src/routes/reportRoutes.js
const express = require('express');
const ctl = require('../controllers/reportController');

const r = express.Router();

// shared filters
r.get('/filters', ctl.getFilters);

// borrowers summary
r.get('/borrowers/loan-summary', ctl.borrowersLoanSummary);

// loans
r.get('/loans/summary', ctl.loansSummary);
r.get('/loans/export/csv', ctl.loansExportCSV);
r.get('/loans/export/pdf', ctl.loansExportPDF);
r.get('/loans/trends', ctl.loansTrends);

// arrears aging / par / outstanding
r.get('/arrears-aging', ctl.arrearsAging);
r.get('/outstanding', ctl.outstandingReport);
r.get('/par/summary', ctl.parSummary);

// collections
r.get('/collections/summary', ctl.collectionsSummary);
r.get('/collectors/summary', ctl.collectorSummary);

// disbursements / fees / officer / products
r.get('/disbursements/summary', ctl.disbursementsSummary);
r.get('/fees/summary', ctl.feesSummary);
r.get('/loan-officers/summary', ctl.loanOfficerSummary);
r.get('/loan-products/summary', ctl.loanProductsSummary);

// mfrs + daily/monthly + glance + all
r.get('/mfrs', ctl.mfrsRatios);
r.get('/daily', ctl.dailyReport);
r.get('/monthly', ctl.monthlyReport);
r.get('/at-a-glance', ctl.atAGlance);
r.get('/all-entries', ctl.allEntries);

module.exports = r;
