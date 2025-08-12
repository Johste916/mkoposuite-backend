'use strict';
const { Op, fn, col, literal } = require('sequelize');
const { sequelize } = require('../models');

const get = (n) => {
  const m = sequelize?.models?.[n];
  if (!m) throw Object.assign(new Error(`Model "${n}" not found`), { status: 500, expose: true });
  return m;
};

/** GET /accounting/chart-of-accounts */
exports.chartOfAccounts = async (_req, res) => {
  const Account = get('Account');
  const rows = await Account.findAll({ order: [['code', 'ASC']] });
  res.json(rows);
};

/** GET /accounting/ledger?accountId=&from=&to= */
exports.ledger = async (req, res) => {
  const LedgerEntry = get('LedgerEntry');
  const where = {};
  if (req.query.accountId && LedgerEntry.rawAttributes.accountId) where.accountId = req.query.accountId;
  if ((req.query.from || req.query.to) && LedgerEntry.rawAttributes.date) {
    where.date = {};
    if (req.query.from) where.date[Op.gte] = req.query.from;
    if (req.query.to) where.date[Op.lte] = req.query.to;
  }
  const rows = await LedgerEntry.findAll({ where, order: [['date', 'ASC'], ['id', 'ASC']] });
  res.json(rows);
};

/** GET /accounting/trial-balance?asOf=YYYY-MM-DD */
exports.trialBalance = async (req, res) => {
  const LedgerEntry = get('LedgerEntry');
  const Account = get('Account');

  const where = {};
  if (req.query.asOf && LedgerEntry.rawAttributes.date) where.date = { [Op.lte]: req.query.asOf };

  const sums = await LedgerEntry.findAll({
    attributes: ['accountId', [fn('SUM', col('debit')), 'debit'], [fn('SUM', col('credit')), 'credit']],
    where,
    group: ['accountId'],
    raw: true,
  });

  const accounts = await Account.findAll({ raw: true });
  const byId = Object.fromEntries(accounts.map(a => [a.id, a]));

  const result = sums.map(r => ({
    accountId: r.accountId,
    accountCode: byId[r.accountId]?.code || null,
    accountName: byId[r.accountId]?.name || null,
    debit: Number(r.debit || 0),
    credit: Number(r.credit || 0),
    balance: Number(r.debit || 0) - Number(r.credit || 0),
  }));

  res.json(result);
};

/** GET /accounting/profit-loss?from=&to= */
exports.profitLoss = async (req, res) => {
  const LedgerEntry = get('LedgerEntry');
  const Account = get('Account');

  const where = {};
  if ((req.query.from || req.query.to) && LedgerEntry.rawAttributes.date) {
    where.date = {};
    if (req.query.from) where.date[Op.gte] = req.query.from;
    if (req.query.to) where.date[Op.lte] = req.query.to;
  }

  const accounts = await Account.findAll({ raw: true });
  const accById = Object.fromEntries(accounts.map(a => [a.id, a]));

  const rows = await LedgerEntry.findAll({
    attributes: ['accountId', [fn('SUM', col('debit')), 'debit'], [fn('SUM', col('credit')), 'credit']],
    where, group: ['accountId'], raw: true,
  });

  let totalIncome = 0, totalExpense = 0;
  rows.forEach(r => {
    const acc = accById[r.accountId];
    const debit = Number(r.debit || 0);
    const credit = Number(r.credit || 0);
    if (acc?.type === 'income') totalIncome += (credit - debit); // income increases with credit
    if (acc?.type === 'expense') totalExpense += (debit - credit); // expense increases with debit
  });

  res.json({ totalIncome, totalExpense, netProfit: totalIncome - totalExpense });
};

/** GET /accounting/cashflow-monthly?year=YYYY */
exports.cashflowMonthly = async (req, res) => {
  const LedgerEntry = get('LedgerEntry');
  const Account = get('Account');
  const year = req.query.year || new Date().getFullYear();

  const accounts = await Account.findAll({ raw: true });
  const cashIds = accounts.filter(a => a.type === 'cash').map(a => a.id);
  if (!cashIds.length) return res.json([]);

  const rows = await LedgerEntry.findAll({
    attributes: [
      [fn('DATE_TRUNC', 'month', col('date')), 'month'],
      [fn('SUM', col('debit')), 'debit'],
      [fn('SUM', col('credit')), 'credit'],
    ],
    where: {
      accountId: { [Op.in]: cashIds },
      date: { [Op.gte]: `${year}-01-01`, [Op.lte]: `${year}-12-31` },
    },
    group: [literal('1')],
    order: [literal('1 ASC')],
    raw: true,
  });

  const result = rows.map(r => ({
    month: new Date(r.month).toISOString().slice(0, 7),
    inflow: Number(r.debit || 0),
    outflow: Number(r.credit || 0),
    net: Number(r.debit || 0) - Number(r.credit || 0),
  }));

  res.json(result);
};

/** POST /accounting/manual-journal  { date, memo, lines: [{ accountId, debit, credit, description }] } */
exports.createManualJournal = async (req, res) => {
  const JournalEntry = get('JournalEntry');
  const LedgerEntry = get('LedgerEntry');

  const { date, memo, lines } = req.body || {};
  if (!Array.isArray(lines) || !lines.length) {
    return res.status(400).json({ error: 'lines[] is required' });
  }
  const totalDebit = lines.reduce((s, l) => s + Number(l.debit || 0), 0);
  const totalCredit = lines.reduce((s, l) => s + Number(l.credit || 0), 0);
  if (Number(totalDebit.toFixed(2)) !== Number(totalCredit.toFixed(2))) {
    return res.status(400).json({ error: 'Debits must equal credits' });
  }

  const t = await sequelize.transaction();
  try {
    const journal = await JournalEntry.create({ date, memo }, { transaction: t });
    for (const ln of lines) {
      await LedgerEntry.create({
        journalEntryId: journal.id,
        date,
        accountId: ln.accountId,
        debit: ln.debit || 0,
        credit: ln.credit || 0,
        description: ln.description || null,
      }, { transaction: t });
    }
    await t.commit();
    res.status(201).json({ ok: true, journalId: journal.id });
  } catch (e) {
    await t.rollback();
    throw e;
  }
};
