'use strict';
const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/accountingController');

// Base: /api/accounting

// Chart of Accounts
// GET /api/accounting/chart-of-accounts
router.get('/chart-of-accounts', ctrl.chartOfAccounts);

// Ledger (filters: accountId, from, to)
// GET /api/accounting/ledger?accountId=&from=&to=
router.get('/ledger', ctrl.ledger);

// Trial Balance (as of date)
// GET /api/accounting/trial-balance?asOf=YYYY-MM-DD
router.get('/trial-balance', ctrl.trialBalance);

// Profit & Loss (date range)
// GET /api/accounting/profit-loss?from=&to=
router.get('/profit-loss', ctrl.profitLoss);

// Cashflow Monthly (year)
// GET /api/accounting/cashflow-monthly?year=YYYY
router.get('/cashflow-monthly', ctrl.cashflowMonthly);

// Create a manual journal (balanced lines)
// POST /api/accounting/manual-journal
// Body: { date, memo, lines: [{ accountId, debit, credit, description }] }
router.post('/manual-journal', ctrl.createManualJournal);

/* ---------- OPTIONAL DEV HELPERS (uncomment if you added them) ----------
const { sequelize } = require('../models');

// Quickly sync tables in dev
router.post('/dev/sync', async (req, res, next) => {
  try {
    await sequelize.sync({ alter: true });
    res.json({ ok: true, message: 'DB synced (dev)' });
  } catch (e) { next(e); }
});

// Seed minimal CoA and one sample journal
router.post('/dev/seed', async (req, res, next) => {
  try {
    const { Account, JournalEntry, LedgerEntry } = require('../models');
    const [cash] = await Account.findOrCreate({ where: { code: '1000' }, defaults: { name: 'Cash', type: 'cash' } });
    const [sales] = await Account.findOrCreate({ where: { code: '4000' }, defaults: { name: 'Sales Income', type: 'income' } });
    const [rent]  = await Account.findOrCreate({ where: { code: '6000' }, defaults: { name: 'Rent Expense', type: 'expense' } });
    const je = await JournalEntry.create({ date: new Date(), memo: 'Initial seed example' });
    await LedgerEntry.bulkCreate([
      { journalEntryId: je.id, date: je.date, accountId: cash.id,  debit: 100000, credit: 0,      description: 'Cash received' },
      { journalEntryId: je.id, date: je.date, accountId: sales.id, debit: 0,      credit: 100000, description: 'Sales' },
    ]);
    res.json({ ok: true, accounts: [cash, sales, rent].map(a => ({ id: a.id, code: a.code, name: a.name })) });
  } catch (e) { next(e); }
});
-------------------------------------------------------------------------- */

module.exports = router;
