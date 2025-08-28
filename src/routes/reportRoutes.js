// server/src/routes/reportRoutes.js
const express = require('express');
const router = express.Router();
const { authenticateUser } = require('../middleware/authMiddleware');
const ctrl = require('../controllers/reportController');

// 🔎 Filters (branches, officers, products, borrowers) – no paranoid joins
router.get('/filters', authenticateUser, ctrl.getFilters);

/** Borrowers report (loan summary style) */
router.get('/borrowers/loan-summary', authenticateUser, ctrl.borrowersLoanSummary);

/** PAR snapshot */
router.get('/par/summary', authenticateUser, ctrl.parSummary);

/** Loan register / summary */
router.get('/loans/summary', authenticateUser, ctrl.loansSummary);
router.get('/loans/export/csv', authenticateUser, ctrl.loansExportCSV);

/** Arrears aging buckets */
router.get('/arrears-aging', authenticateUser, ctrl.arrearsAging);

/** Collections */
router.get('/collections/summary', authenticateUser, ctrl.collectionsSummary);

/** Collector performance */
router.get('/collectors/summary', authenticateUser, ctrl.collectorSummary);

/** Deferred income */
router.get('/deferred-income', authenticateUser, ctrl.deferredIncome);
router.get('/deferred-income/monthly', authenticateUser, ctrl.deferredIncomeMonthly);

/** Pro-rata collections */
router.get('/pro-rata-collections', authenticateUser, ctrl.proRataCollections);

/** Disbursements */
router.get('/disbursements/summary', authenticateUser, ctrl.disbursementsSummary);

/** Fees */
router.get('/fees/summary', authenticateUser, ctrl.feesSummary);

/** Loan officer */
router.get('/loan-officers/summary', authenticateUser, ctrl.loanOfficerSummary);

/** Loan products */
router.get('/loan-products/summary', authenticateUser, ctrl.loanProductsSummary);

/** MFRS ratios */
router.get('/mfrs', authenticateUser, ctrl.mfrsRatios);

/** Daily / Monthly management packs */
router.get('/daily', authenticateUser, ctrl.dailyReport);
router.get('/monthly', authenticateUser, ctrl.monthlyReport);

/** Outstanding snapshot */
router.get('/outstanding', authenticateUser, ctrl.outstandingReport);

/** At a glance */
router.get('/at-a-glance', authenticateUser, ctrl.atAGlance);

/** All entries (flat ledger) */
router.get('/all-entries', authenticateUser, ctrl.allEntries);

/* ---- Back-compat (optional) ---- */
router.get('/summary', authenticateUser, ctrl.borrowersLoanSummary);
router.get('/trends', authenticateUser, ctrl.loansTrends);
router.get('/export/csv', authenticateUser, ctrl.loansExportCSV);
router.get('/export/pdf', authenticateUser, ctrl.loansExportPDF);

module.exports = router;
