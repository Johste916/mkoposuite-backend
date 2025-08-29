'use strict';
const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/accountingController');

// Base: /api/accounting

// Chart of Accounts
router.get('/chart-of-accounts', ctrl.chartOfAccounts);

// Ledger (filters: accountId, from, to)
router.get('/ledger', ctrl.ledger);

// Trial Balance (as of date)
router.get('/trial-balance', ctrl.trialBalance);
// ✅ CSV export
router.get('/trial-balance/export/csv', ctrl.trialBalanceCSV);

// Profit & Loss (date range)
router.get('/profit-loss', ctrl.profitLoss);
// ✅ CSV export
router.get('/profit-loss/export/csv', ctrl.profitLossCSV);

// Cashflow Monthly (year)
router.get('/cashflow-monthly', ctrl.cashflowMonthly);

// Create a manual journal (balanced lines)
router.post('/manual-journal', ctrl.createManualJournal);

module.exports = router;
