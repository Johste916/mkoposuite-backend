'use strict';
const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/accountingController');

// Base: /api/accounting

// Diagnostics (see what's missing)
router.get('/diagnostics', ctrl.diagnostics);

// Chart of Accounts
router.get('/chart-of-accounts', ctrl.chartOfAccounts);

// Ledger
router.get('/ledger', ctrl.ledger);

// Trial Balance
router.get('/trial-balance', ctrl.trialBalance);
// CSV (optional, handy for export)
router.get('/trial-balance.csv', ctrl.trialBalanceCSV);

// Profit & Loss
router.get('/profit-loss', ctrl.profitLoss);
router.get('/profit-loss.csv', ctrl.profitLossCSV);

// Cashflow Monthly
router.get('/cashflow-monthly', ctrl.cashflowMonthly);

// Manual Journal
router.post('/manual-journal', ctrl.createManualJournal);

/* ---------- DEV HELPERS (guarded) ---------- */
if (process.env.ENABLE_ACCOUNTING_DEV === 'true') {
  const { sequelize } = require('../models');

  // Sync (dangerous on prod; only when you know what you’re doing)
  router.post('/dev/sync', async (_req, res, next) => {
    try {
      await sequelize.sync({ alter: true });
      res.json({ ok: true, message: 'DB synced (dev)' });
    } catch (e) { next(e); }
  });

  // Seed minimal CoA and one sample journal
  router.post('/dev/seed-basic', async (_req, res, next) => {
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

      res.json({
        ok: true,
        accounts: [cash, sales, rent].map(a => ({ id: a.id, code: a.code, name: a.name, type: a.type })),
        journalId: je.id,
      });
    } catch (e) { next(e); }
  });
}

module.exports = router;
