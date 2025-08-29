'use strict';
const { Op, fn, col, literal } = require('sequelize');

let db = {};
try { db = require('../models'); } catch (e) { db = {}; }
const { sequelize } = db || {};

let Parser;
try { ({ Parser } = require('json2csv')); } catch { /* fallback to manual CSV */ }

/* ───────────── helpers: schema-safe, tenant-aware, csv ───────────── */
const safeNumber = (v) => Number(v || 0);

function hasAttr(model, name) {
  if (!model?.rawAttributes) return false;
  for (const [key, def] of Object.entries(model.rawAttributes)) {
    if (key === name || def?.field === name) return true;
  }
  return false;
}
function resolveAttr(model, candidates = []) {
  if (!model?.rawAttributes) return null;
  for (const want of candidates) {
    for (const [key, def] of Object.entries(model.rawAttributes)) {
      if (key === want || def?.field === want) return { attrKey: key, fieldName: def?.field || key };
    }
  }
  return null;
}
function pickAttrKey(model, candidates = []) { const r = resolveAttr(model, candidates); return r ? r.attrKey : null; }
function pickFieldName(model, candidates = []) { const r = resolveAttr(model, candidates); return r ? r.fieldName : null; }

function tenantFilter(model, req) {
  const tenantId =
    req?.tenant?.id ||
    req?.headers?.['x-tenant-id'] ||
    req?.headers?.['X-Tenant-Id'];
  const key = pickAttrKey(model, ['tenantId', 'tenant_id']);
  return tenantId && key ? { [key]: tenantId } : {};
}

function getModel(name) {
  const m = db?.[name] || sequelize?.models?.[name];
  if (!m) throw Object.assign(new Error(`Model "${name}" not found`), { status: 500, expose: true });
  return m;
}

function toCSV(rows) {
  if (Parser) {
    const p = new Parser();
    return p.parse(rows || []);
  }
  // manual
  const esc = (s) => {
    const v = s == null ? '' : String(s);
    return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  };
  const cols = Array.from((rows || []).reduce((set, r) => {
    Object.keys(r || {}).forEach(k => set.add(k));
    return set;
  }, new Set()));
  const lines = [
    cols.join(','),
    ...(rows || []).map(r => cols.map(c => esc(r[c])).join(','))
  ];
  return lines.join('\n');
}
function sendCSV(res, filename, rows) {
  const csv = toCSV(rows);
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(csv);
}

/* ───────────────────────────── endpoints ──────────────────────────── */
/** GET /accounting/chart-of-accounts */
exports.chartOfAccounts = async (req, res, next) => {
  try {
    const Account = getModel('Account');

    const idKey    = pickAttrKey(Account, ['id']);
    const codeKey  = pickAttrKey(Account, ['code', 'accountCode', 'number']);
    const nameKey  = pickAttrKey(Account, ['name', 'accountName', 'title']);
    const typeKey  = pickAttrKey(Account, ['type', 'category', 'group']);

    const rows = await Account.findAll({
      where: tenantFilter(Account, req),
      attributes: [idKey, codeKey, nameKey, typeKey].filter(Boolean),
      order: codeKey ? [[codeKey, 'ASC']] : nameKey ? [[nameKey, 'ASC']] : undefined,
      raw: true
    });

    res.json(rows);
  } catch (e) { next(e); }
};

/** GET /accounting/ledger?accountId=&from=&to= */
exports.ledger = async (req, res, next) => {
  try {
    const Ledger = getModel('LedgerEntry');

    const idKey        = pickAttrKey(Ledger, ['id']);
    const accountIdKey = pickAttrKey(Ledger, ['accountId', 'account_id']);
    const dateKey      = pickAttrKey(Ledger, ['date', 'entryDate', 'createdAt', 'created_at']);
    const debitKey     = pickAttrKey(Ledger, ['debit', 'debitAmount', 'dr']);
    const creditKey    = pickAttrKey(Ledger, ['credit', 'creditAmount', 'cr']);
    const descKey      = pickAttrKey(Ledger, ['description', 'memo', 'note']);
    const journalKey   = pickAttrKey(Ledger, ['journalEntryId', 'journal_id', 'entryId']);

    const where = {
      ...(accountIdKey && req.query.accountId ? { [accountIdKey]: req.query.accountId } : {}),
      ...(dateKey && (req.query.from || req.query.to) ? {
        [dateKey]: {
          ...(req.query.from ? { [Op.gte]: req.query.from } : {}),
          ...(req.query.to ? { [Op.lte]: req.query.to } : {})
        }
      } : {}),
      ...tenantFilter(Ledger, req)
    };

    const rows = await Ledger.findAll({
      where,
      attributes: [idKey, accountIdKey, dateKey, debitKey, creditKey, descKey, journalKey].filter(Boolean),
      order: [
        ...(dateKey ? [[dateKey, 'ASC']] : []),
        ...(idKey ? [[idKey, 'ASC']] : [])
      ],
      raw: true
    });

    res.json(rows);
  } catch (e) { next(e); }
};

/* ───────────── shared calculators (used by JSON + CSV) ────────────── */
async function computeTrialBalance(req) {
  const Ledger = getModel('LedgerEntry');
  const Account = getModel('Account');

  const accountIdKey = pickAttrKey(Ledger, ['accountId', 'account_id']);
  const dateKey      = pickAttrKey(Ledger, ['date', 'entryDate', 'createdAt', 'created_at']);
  const debitKey     = pickAttrKey(Ledger, ['debit', 'debitAmount', 'dr']);
  const creditKey    = pickAttrKey(Ledger, ['credit', 'creditAmount', 'cr']);
  if (!accountIdKey || !debitKey || !creditKey) return [];

  const where = {
    ...(dateKey && req.query.asOf ? { [dateKey]: { [Op.lte]: req.query.asOf } } : {}),
    ...tenantFilter(Ledger, req)
  };

  const sums = await Ledger.findAll({
    where,
    attributes: [
      [col(Ledger.rawAttributes[accountIdKey].field || accountIdKey), 'accountId'],
      [fn('SUM', col(Ledger.rawAttributes[debitKey].field || debitKey)), 'debit'],
      [fn('SUM', col(Ledger.rawAttributes[creditKey].field || creditKey)), 'credit'],
    ],
    group: [col(Ledger.rawAttributes[accountIdKey].field || accountIdKey)],
    raw: true
  });

  const A = getModel('Account');
  const idKey   = pickAttrKey(A, ['id']);
  const codeKey = pickAttrKey(A, ['code', 'accountCode', 'number']);
  const nameKey = pickAttrKey(A, ['name', 'accountName', 'title']);

  const accRows = await A.findAll({
    attributes: [idKey, codeKey, nameKey].filter(Boolean),
    where: tenantFilter(A, req),
    raw: true
  });
  const byId = new Map(accRows.map(a => [String(a[idKey || 'id']), a]));

  return (sums || []).map(r => {
    const acc = byId.get(String(r.accountId)) || {};
    const debit  = safeNumber(r.debit);
    const credit = safeNumber(r.credit);
    return {
      accountId: r.accountId,
      accountCode: acc[codeKey] ?? null,
      accountName: acc[nameKey] ?? null,
      debit,
      credit,
      balance: debit - credit,
    };
  });
}

async function computeProfitLoss(req) {
  const Ledger = getModel('LedgerEntry');
  const Account = getModel('Account');

  const accountIdKey = pickAttrKey(Ledger, ['accountId', 'account_id']);
  const dateKey      = pickAttrKey(Ledger, ['date', 'entryDate', 'createdAt', 'created_at']);
  const debitKey     = pickAttrKey(Ledger, ['debit', 'debitAmount', 'dr']);
  const creditKey    = pickAttrKey(Ledger, ['credit', 'creditAmount', 'cr']);
  if (!accountIdKey || !debitKey || !creditKey) return { totalIncome: 0, totalExpense: 0, netProfit: 0, income: [], expense: [] };

  const where = {
    ...(dateKey && (req.query.from || req.query.to) ? {
      [dateKey]: {
        ...(req.query.from ? { [Op.gte]: req.query.from } : {}),
        ...(req.query.to ? { [Op.lte]: req.query.to } : {})
      }
    } : {}),
    ...tenantFilter(Ledger, req)
  };

  const sums = await Ledger.findAll({
    where,
    attributes: [
      [col(Ledger.rawAttributes[accountIdKey].field || accountIdKey), 'accountId'],
      [fn('SUM', col(Ledger.rawAttributes[debitKey].field || debitKey)), 'debit'],
      [fn('SUM', col(Ledger.rawAttributes[creditKey].field || creditKey)), 'credit'],
    ],
    group: [col(Ledger.rawAttributes[accountIdKey].field || accountIdKey)],
    raw: true
  });

  const idKey   = pickAttrKey(Account, ['id']);
  const codeKey = pickAttrKey(Account, ['code', 'accountCode', 'number']);
  const nameKey = pickAttrKey(Account, ['name', 'accountName', 'title']);
  const typeKey = pickAttrKey(Account, ['type', 'category', 'group']);

  const accRows = await Account.findAll({
    attributes: [idKey, codeKey, nameKey, typeKey].filter(Boolean),
    where: tenantFilter(Account, req),
    raw: true
  });
  const byId = new Map(accRows.map(a => [String(a[idKey || 'id']), a]));

  const income = [];
  const expense = [];
  let totalIncome = 0, totalExpense = 0;

  const isIncomeType  = (t) => /income|revenue/i.test(String(t || ''));
  const isExpenseType = (t) => /expense|operating|cogs|cost/i.test(String(t || ''));

  (sums || []).forEach(r => {
    const acc = byId.get(String(r.accountId)) || {};
    const debit = safeNumber(r.debit);
    const credit = safeNumber(r.credit);
    const rec = {
      accountId: r.accountId,
      code: acc[codeKey] ?? null,
      name: acc[nameKey] ?? null,
      type: acc[typeKey] ?? null,
    };

    if (isIncomeType(acc[typeKey])) {
      const amount = credit - debit; // income up with credit
      income.push({ ...rec, amount });
      totalIncome += amount;
    } else if (isExpenseType(acc[typeKey])) {
      const amount = debit - credit; // expense up with debit
      expense.push({ ...rec, amount });
      totalExpense += amount;
    }
  });

  return { totalIncome, totalExpense, netProfit: totalIncome - totalExpense, income, expense };
}

/* ───────────────────── Trial Balance JSON & CSV ────────────────────── */
exports.trialBalance = async (req, res, next) => {
  try {
    const rows = await computeTrialBalance(req);
    res.json(rows);
  } catch (e) { next(e); }
};
exports.trialBalanceCSV = async (req, res, next) => {
  try {
    const rows = await computeTrialBalance(req);
    const flat = rows.map(r => ({
      accountCode: r.accountCode, accountName: r.accountName,
      debit: r.debit, credit: r.credit, balance: r.balance
    }));
    sendCSV(res, 'trial_balance.csv', flat);
  } catch (e) { next(e); }
};

/* ───────────────────── P&L JSON & CSV ──────────────────────────────── */
exports.profitLoss = async (req, res, next) => {
  try {
    const data = await computeProfitLoss(req);
    res.json(data);
  } catch (e) { next(e); }
};
exports.profitLossCSV = async (req, res, next) => {
  try {
    const data = await computeProfitLoss(req);
    const rows = [
      ...data.income.map(l => ({ section: 'Income', code: l.code, name: l.name, amount: l.amount })),
      { section: 'Income', code: '', name: 'Total Income', amount: data.totalIncome },
      ...data.expense.map(l => ({ section: 'Expense', code: l.code, name: l.name, amount: l.amount })),
      { section: 'Expense', code: '', name: 'Total Expense', amount: data.totalExpense },
      { section: 'Summary', code: '', name: 'Net Profit', amount: data.netProfit },
    ];
    sendCSV(res, 'profit_loss.csv', rows);
  } catch (e) { next(e); }
};

/* ───────────────────── Cashflow (monthly) ──────────────────────────── */
exports.cashflowMonthly = async (req, res, next) => {
  try {
    const Ledger = getModel('LedgerEntry');
    const Account = getModel('Account');

    const year = Number(req.query.year) || new Date().getFullYear();

    const idKey   = pickAttrKey(Account, ['id']);
    const typeKey = pickAttrKey(Account, ['type', 'category', 'group']);

    const accounts = await Account.findAll({
      attributes: [idKey, typeKey].filter(Boolean),
      where: tenantFilter(Account, req),
      raw: true
    });

    const cashIds = accounts
      .filter(a => /cash|bank/i.test(String(a[typeKey] || '')))
      .map(a => a[idKey]);

    if (!cashIds.length) {
      return res.json(Array.from({ length: 12 }, (_, i) => ({
        month: `${year}-${String(i + 1).padStart(2, '0')}`, inflow: 0, outflow: 0, net: 0
      })));
    }

    const accountIdKey = pickAttrKey(Ledger, ['accountId', 'account_id']);
    const dateKey      = pickAttrKey(Ledger, ['date', 'entryDate', 'createdAt', 'created_at']);
    const debitKey     = pickAttrKey(Ledger, ['debit', 'debitAmount', 'dr']);
    const creditKey    = pickAttrKey(Ledger, ['credit', 'creditAmount', 'cr']);

    const rows = await Ledger.findAll({
      attributes: [
        [fn('DATE_TRUNC', 'month', col(Ledger.rawAttributes[dateKey].field || dateKey)), 'month'],
        [fn('SUM', col(Ledger.rawAttributes[debitKey].field || debitKey)), 'debit'],
        [fn('SUM', col(Ledger.rawAttributes[creditKey].field || creditKey)), 'credit'],
      ],
      where: {
        ...(accountIdKey ? { [accountIdKey]: { [Op.in]: cashIds } } : {}),
        ...(dateKey ? { [dateKey]: { [Op.gte]: `${year}-01-01`, [Op.lte]: `${year}-12-31` } } : {}),
        ...tenantFilter(Ledger, req)
      },
      group: [literal('1')],
      order: [literal('1 ASC')],
      raw: true
    });

    const byMonth = new Map((rows || []).map(r => {
      const m = new Date(r.month).toISOString().slice(0, 7);
      return [m, { inflow: safeNumber(r.debit), outflow: safeNumber(r.credit) }];
    }));
    const result = Array.from({ length: 12 }, (_, i) => {
      const label = `${year}-${String(i + 1).padStart(2, '0')}`;
      const agg = byMonth.get(label) || { inflow: 0, outflow: 0 };
      return { month: label, inflow: agg.inflow, outflow: agg.outflow, net: agg.inflow - agg.outflow };
    });

    res.json(result);
  } catch (e) { next(e); }
};

/* ───────────────────── Manual Journal ──────────────────────────────── */
exports.createManualJournal = async (req, res, next) => {
  const t = await sequelize.transaction();
  try {
    const Journal = getModel('JournalEntry');
    const Ledger  = getModel('LedgerEntry');

    const dateKeyJ = pickAttrKey(Journal, ['date', 'postedAt', 'createdAt', 'created_at']);
    const memoKeyJ = pickAttrKey(Journal, ['memo', 'description', 'note']);

    const accountIdKey = pickAttrKey(Ledger, ['accountId', 'account_id']);
    const journalKey   = pickAttrKey(Ledger, ['journalEntryId', 'journal_id', 'entryId']);
    const dateKey      = pickAttrKey(Ledger, ['date', 'entryDate', 'createdAt', 'created_at']);
    const debitKey     = pickAttrKey(Ledger, ['debit', 'debitAmount', 'dr']);
    const creditKey    = pickAttrKey(Ledger, ['credit', 'creditAmount', 'cr']);
    const descKey      = pickAttrKey(Ledger, ['description', 'memo', 'note']);

    const { date, memo, lines } = req.body || {};
    if (!Array.isArray(lines) || !lines.length) {
      return res.status(400).json({ error: 'lines[] is required' });
    }
    const totalDebit = lines.reduce((s, l) => s + safeNumber(l.debit), 0);
    const totalCredit = lines.reduce((s, l) => s + safeNumber(l.credit), 0);
    if (Number(totalDebit.toFixed(2)) !== Number(totalCredit.toFixed(2))) {
      return res.status(400).json({ error: 'Debits must equal credits' });
    }

    const j = {};
    if (dateKeyJ) j[dateKeyJ] = date || new Date();
    if (memoKeyJ) j[memoKeyJ] = memo || null;
    const journal = await Journal.create(j, { transaction: t });

    for (const ln of lines) {
      const rec = {};
      if (journalKey)   rec[journalKey]   = journal.id;
      if (dateKey)      rec[dateKey]      = date || new Date();
      if (accountIdKey) rec[accountIdKey] = ln.accountId;
      if (debitKey)     rec[debitKey]     = safeNumber(ln.debit);
      if (creditKey)    rec[creditKey]    = safeNumber(ln.credit);
      if (descKey)      rec[descKey]      = ln.description || null;

      await Ledger.create(rec, { transaction: t });
    }

    await t.commit();
    res.status(201).json({ ok: true, journalId: journal.id });
  } catch (e) {
    await t.rollback();
    next(e);
  }
};
