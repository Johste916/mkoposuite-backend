const express = require('express');
const router = express.Router();
const report = require('../controllers/reportController');
const { authenticateUser } = require('../middleware/authMiddleware');

/** ---------- Back-compat core endpoints used by Reports.jsx ---------- */
router.get('/summary', authenticateUser, report.summary);          // aka getSummary
router.get('/trends', authenticateUser, report.loansTrends);       // aka getTrends
router.get('/loan-summary', authenticateUser, report.loansSummary);
router.get('/export/csv', authenticateUser, report.exportCSV);
router.get('/export/pdf', authenticateUser, report.exportPDF);

// also support hyphen variants used by some frontends
router.get('/export-csv', authenticateUser, report.exportCSV);
router.get('/export-pdf', authenticateUser, report.exportPDF);

/** ---------- Granular endpoints for each sidebar item ---------- */
router.get('/borrowers/loan-summary', authenticateUser, report.borrowersLoanSummary);
router.get('/loans/summary', authenticateUser, report.loansSummary);
router.get('/arrears-aging', authenticateUser, report.arrearsAging);
router.get('/collections/summary', authenticateUser, report.collectionsSummary);
router.get('/collectors/summary', authenticateUser, report.collectorSummary);
router.get('/deferred-income', authenticateUser, report.deferredIncome);
router.get('/deferred-income/monthly', authenticateUser, report.deferredIncomeMonthly);
router.get('/pro-rata-collections', authenticateUser, report.proRataCollections);
router.get('/disbursements/summary', authenticateUser, report.disbursementSummary);
router.get('/fees/summary', authenticateUser, report.feesSummary);
router.get('/loan-officers/summary', authenticateUser, report.loanOfficerSummary);
router.get('/loan-products/summary', authenticateUser, report.loanProductsSummary);
router.get('/mfrs', authenticateUser, report.mfrsRatios);
router.get('/daily', authenticateUser, report.dailyReport);
router.get('/monthly', authenticateUser, report.monthlyReport);
router.get('/outstanding', authenticateUser, report.outstandingReport);
router.get('/par/summary', authenticateUser, report.parSummary);
router.get('/at-a-glance', authenticateUser, report.atAGlance);
router.get('/all-entries', authenticateUser, report.allEntries);

module.exports = router;
