'use strict';

const express = require('express');
const { Op, fn, literal } = require('sequelize');
const crypto = require('crypto');

const router = express.Router();

function m(req) { return req.app.get('models') || {}; }
function tenantIdFrom(req) {
  return (
    req.headers['x-tenant-id'] ||
    req.headers['x-tenant'] ||
    req.user?.tenantId ||
    process.env.DEFAULT_TENANT_ID ||
    '00000000-0000-0000-0000-000000000000'
  );
}

/* -------------------------------- Helpers -------------------------------- */

function isMissingTable(err) {
  // Postgres: 42P01 = undefined_table
  return err?.original?.code === '42P01' || err?.code === '42P01';
}
function respondMissingTable(res, tableLabel) {
  return res.status(500).json({
    error: `Storage for ${tableLabel} is not initialized on this environment.`,
    code: '42P01',
    hint: 'Run DB migrations / sync to create the missing tables.',
  });
}

/* ----------------------------- Codes (types/status) ----------------------------- */
router.get('/codes', async (req, res) => {
  const { Setting } = m(req);
  const tenantId = tenantIdFrom(req);

  const defaults = {
    transactionTypes: ['deposit','withdrawal','loan_repayment','disbursement','fee','transfer_in','transfer_out','other'],
    statuses: ['posted','pending','void'],
    channels: ['bank','cash','mobile','card','other'],
  };

  if (!Setting) return res.json(defaults);

  try {
    const row = await Setting.findOne({ where: { key: 'bank.codes', tenantId } });
    if (!row?.value) return res.json(defaults);
    const payload = typeof row.value === 'string' ? JSON.parse(row.value) : row.value;
    return res.json({ ...defaults, ...(payload || {}) });
  } catch {
    return res.json(defaults);
  }
});

// Optional: /banks/codes/:group
router.get('/codes/:group', async (req, res) => {
  const sub = await new Promise((resolve) => {
    const _res = { json: (x) => resolve(x) };
    router.handle({ ...req, method: 'GET', url: '/codes' }, _res);
  });
  const key = String(req.params.group || '').trim();
  if (!key || !(key in sub)) return res.json(sub);
  res.json({ [key]: sub[key] });
});

/* --------------------------------- Banks: CRUD --------------------------------- */

// GET /api/banks?search=
router.get('/', async (req, res) => {
  const { Bank } = m(req);
  if (!Bank) return res.json([]);
  try {
    const where = { tenantId: tenantIdFrom(req) };
    const search = String(req.query.search || '').trim();
    const like = (s) => ({ [Op.iLike]: `%${s}%` });
    if (search) {
      where[Op.or] = [
        { name: like(search) },
        { code: like(search) },
        { branch: like(search) },
        { accountName: like(search) },
        { accountNumber: like(search) },
        { swift: like(search) },
      ];
    }
    const list = await Bank.findAll({ where, order: [['name', 'ASC']] });
    res.setHeader('X-Total-Count', String(list.length));
    return res.json(list);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// POST /api/banks
router.post('/', async (req, res) => {
  const { Bank } = m(req);
  if (!Bank) return res.status(500).json({ error: 'Bank model unavailable' });

  try {
    const b = req.body || {};
    const accountName = b.accountName ?? null;
    const accountNumber = b.accountNumber ?? null;

    const payload = {
      id: b.id || crypto.randomUUID(),
      tenantId: tenantIdFrom(req),
      name: String(b.name || '').trim(),
      code: b.code || null,
      branch: b.branch || null,

      accountName,
      accountNumber,

      // if legacy camelCase columns exist in DB, these keep them in sync harmlessly
      accountNameLegacy: accountName,
      accountNumberLegacy: accountNumber,

      swift: b.swift || null,
      phone: b.phone || null,
      address: b.address || null,
      currency: (b.currency || 'TZS').toUpperCase(),
      openingBalance: Number(b.openingBalance || 0),
      currentBalance: Number(b.currentBalance ?? b.openingBalance ?? 0),
      isActive: b.isActive !== false,
    };

    const created = await Bank.create(payload);
    return res.status(201).json(created);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// GET /api/banks/:id
router.get('/:id', async (req, res) => {
  const { Bank, BankTransaction } = m(req);
  const id = String(req.params.id);

  try {
    const bank = await Bank.findOne({ where: { id, tenantId: tenantIdFrom(req) } });
    if (!bank) return res.status(404).json({ error: 'Bank not found' });

    let inflow = 0, outflow = 0;
    if (BankTransaction) {
      try {
        const txs = await BankTransaction.findAll({
          attributes: [
            [fn('SUM', literal(`CASE WHEN direction='in'  THEN amount ELSE 0 END`)), 'inflow'],
            [fn('SUM', literal(`CASE WHEN direction='out' THEN amount ELSE 0 END`)), 'outflow'],
          ],
          where: { bankId: id, status: 'posted' },
          raw: true,
        });
        inflow = Number(txs?.[0]?.inflow || 0);
        outflow = Number(txs?.[0]?.outflow || 0);
      } catch (e) {
        if (!isMissingTable(e)) throw e;
      }
    }

    const opening = Number(bank.openingBalance || 0);
    const computedCurrent = opening + inflow - outflow;
    const data = bank.toJSON();
    data.balances = { opening, inflow, outflow, current: computedCurrent };
    return res.json(data);
  } catch (e) {
    if (isMissingTable(e)) return respondMissingTable(res, 'bank transactions');
    return res.status(500).json({ error: e.message });
  }
});

// PUT/PATCH /api/banks/:id
async function updateBank(req, res) {
  const { Bank } = m(req);
  const id = String(req.params.id);
  try {
    const bank = await Bank.findOne({ where: { id, tenantId: tenantIdFrom(req) } });
    if (!bank) return res.status(404).json({ error: 'Bank not found' });

    const b = req.body || {};
    const updates = {};
    ['name','code','branch','accountName','accountNumber','swift','phone','address','currency'].forEach(k => {
      if (k in b) updates[k] = k === 'currency' && typeof b[k] === 'string' ? b[k].toUpperCase() : b[k];
    });
    if ('openingBalance' in b) updates.openingBalance = Number(b.openingBalance);
    if ('currentBalance' in b) updates.currentBalance = Number(b.currentBalance);
    if ('isActive' in b) updates.isActive = !!b.isActive;

    // keep legacy camel columns in sync (if they still exist)
    if ('accountName' in b)   updates.accountNameLegacy   = b.accountName ?? null;
    if ('accountNumber' in b) updates.accountNumberLegacy = b.accountNumber ?? null;

    await bank.update(updates);
    return res.json(bank);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
router.patch('/:id', updateBank);
router.put('/:id', updateBank);

// DELETE /api/banks/:id
router.delete('/:id', async (req, res) => {
  const { Bank } = m(req);
  const id = String(req.params.id);
  try {
    const bank = await Bank.findOne({ where: { id, tenantId: tenantIdFrom(req) } });
    if (!bank) return res.status(404).json({ error: 'Bank not found' });
    await bank.destroy();
    return res.status(204).end();
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

/* -------------------- “Generic” lists/balances used by UI -------------------- */

// List ALL bank transactions (UI calls /api/banks/transactions)
router.get('/transactions', async (req, res) => {
  const { BankTransaction } = m(req);
  if (!BankTransaction) return res.json([]);
  try {
    const where = { tenantId: tenantIdFrom(req) };
    if (req.query.status) where.status = String(req.query.status);
    if (req.query.type) where.type = String(req.query.type);
    const rows = await BankTransaction.findAll({ where, order: [['occurredAt','DESC'], ['createdAt','DESC']] });
    res.setHeader('X-Total-Count', String(rows.length));
    return res.json(rows);
  } catch (e) {
    if (isMissingTable(e)) return res.json([]);
    return res.status(500).json({ error: e.message });
  }
});

async function genericBalance(req, res, scope) {
  const { BankTransaction } = m(req);
  if (!BankTransaction) return res.json({ inflow: 0, outflow: 0, count: 0 });

  const where = { tenantId: tenantIdFrom(req) };
  if (scope === 'transfers') where.type = { [Op.in]: ['transfer_in','transfer_out'] };
  if (scope === 'reconciliation') where.reconciled = true;
  if (scope === 'approvals') where.status = 'pending';

  try {
    const sums = await BankTransaction.findAll({
      attributes: [
        [fn('SUM', literal(`CASE WHEN direction='in'  THEN amount ELSE 0 END`)), 'inflow'],
        [fn('SUM', literal(`CASE WHEN direction='out' THEN amount ELSE 0 END`)), 'outflow'],
        [fn('COUNT', literal('*')), 'count'],
      ],
      where,
      raw: true,
    });
    const row = sums?.[0] || {};
    return res.json({
      inflow: Number(row.inflow || 0),
      outflow: Number(row.outflow || 0),
      count: Number(row.count || 0),
    });
  } catch (e) {
    if (isMissingTable(e)) return res.json({ inflow: 0, outflow: 0, count: 0 });
    return res.status(500).json({ error: e.message });
  }
}

;['transactions','transfers','reconciliation','statements','approvals','rules','import'].forEach(scope => {
  router.get(`/${scope}`, async (_req, res) => res.json({ items: [] })); // placeholder list
  router.get(`/${scope}/balance`, (req, res) => genericBalance(req, res, scope));
});

/* ---------------------- Banks: Transactions, repay, reconcile ---------------------- */

// GET /api/banks/:id/transactions
router.get('/:id/transactions', async (req, res) => {
  const { BankTransaction } = m(req);
  const id = String(req.params.id);
  if (!BankTransaction) return res.json([]);

  try {
    const where = { bankId: id, tenantId: tenantIdFrom(req) };
    if (req.query.type)      where.type = String(req.query.type);
    if (req.query.status)    where.status = String(req.query.status);
    if (req.query.reconciled === '1' || req.query.reconciled === 'true') where.reconciled = true;
    if (req.query.reconciled === '0' || req.query.reconciled === 'false') where.reconciled = false;
    if (req.query.from || req.query.to) {
      where.occurredAt = {};
      if (req.query.from) where.occurredAt[Op.gte] = new Date(req.query.from);
      if (req.query.to)   where.occurredAt[Op.lte] = new Date(req.query.to);
    }
    const rows = await BankTransaction.findAll({ where, order: [['occurredAt', 'DESC'], ['createdAt', 'DESC']] });
    res.setHeader('X-Total-Count', String(rows.length));
    return res.json(rows);
  } catch (e) {
    if (isMissingTable(e)) return res.json([]);
    return res.status(500).json({ error: e.message });
  }
});

// POST /api/banks/:id/transactions
router.post('/:id/transactions', async (req, res) => {
  const { Bank, BankTransaction } = m(req);
  const bankId = String(req.params.id);
  const tenantId = tenantIdFrom(req);

  try {
    const bank = await Bank.findOne({ where: { id: bankId, tenantId } });
    if (!bank) return res.status(404).json({ error: 'Bank not found' });

    const b = req.body || {};
    const payload = {
      id: b.id || crypto.randomUUID(),
      tenantId,
      bankId,
      direction: b.direction || (['withdrawal','disbursement','fee','transfer_out'].includes(b.type) ? 'out' : 'in'),
      type: b.type || 'other',
      amount: Number(b.amount || 0),
      currency: (b.currency || bank.currency || 'TZS').toUpperCase(),
      occurredAt: b.occurredAt ? new Date(b.occurredAt) : new Date(),
      reference: b.reference || null,
      bankRef: b.bankRef || null,
      description: b.description || null,
      note: b.note || null,
      status: b.status || 'posted',
      loanId: b.loanId || null,
      borrowerId: b.borrowerId || null,
      createdBy: req.user?.id || null,
      meta: b.meta || null,
    };

    if (!payload.amount || payload.amount <= 0) {
      return res.status(400).json({ error: 'amount must be > 0' });
    }
    if (!BankTransaction) {
      return respondMissingTable(res, 'bank transactions');
    }

    const created = await BankTransaction.create(payload);
    return res.status(201).json(created);
  } catch (e) {
    if (isMissingTable(e)) return respondMissingTable(res, 'bank transactions');
    return res.status(500).json({ error: e.message });
  }
});

// POST /api/banks/:id/repayments
router.post('/:id/repayments', async (req, res) => {
  const b = req.body || {};
  if (!b.loanId)  return res.status(400).json({ error: 'loanId is required' });
  if (!b.amount)  return res.status(400).json({ error: 'amount is required' });

  req.body = { ...b, type: 'loan_repayment', direction: 'in' };
  return router.handle({ ...req, url: `/api/banks/${req.params.id}/transactions`, method: 'POST' }, res);
});

// POST /api/banks/transactions/:txId/reconcile
router.post('/transactions/:txId/reconcile', async (req, res) => {
  const { BankTransaction } = m(req);
  if (!BankTransaction) return respondMissingTable(res, 'bank transactions');
  try {
    const txId = String(req.params.txId);
    const tx = await BankTransaction.findOne({ where: { id: txId, tenantId: tenantIdFrom(req) } });
    if (!tx) return res.status(404).json({ error: 'Transaction not found' });

    await tx.update({
      reconciled: true,
      reconciledAt: new Date(),
      reconciledBy: req.user?.id || null,
      bankRef: req.body?.bankRef || tx.bankRef || null,
      note: req.body?.note ?? tx.note,
    });
    res.json(tx);
  } catch (e) {
    if (isMissingTable(e)) return respondMissingTable(res, 'bank transactions');
    return res.status(500).json({ error: e.message });
  }
});

// POST /api/banks/transactions/:txId/unreconcile
router.post('/transactions/:txId/unreconcile', async (req, res) => {
  const { BankTransaction } = m(req);
  if (!BankTransaction) return respondMissingTable(res, 'bank transactions');
  try {
    const txId = String(req.params.txId);
    const tx = await BankTransaction.findOne({ where: { id: txId, tenantId: tenantIdFrom(req) } });
    if (!tx) return res.status(404).json({ error: 'Transaction not found' });

    await tx.update({ reconciled: false, reconciledAt: null, reconciledBy: null, note: req.body?.note ?? tx.note });
    res.json(tx);
  } catch (e) {
    if (isMissingTable(e)) return respondMissingTable(res, 'bank transactions');
    return res.status(500).json({ error: e.message });
  }
});

/* -------------------------------- Transfers -------------------------------- */

// POST /api/banks/:id/transfer
router.post('/:id/transfer', async (req, res) => {
  const { sequelize, Bank, BankTransaction } = m(req);
  if (!BankTransaction) return respondMissingTable(res, 'bank transactions');

  const tenantId = tenantIdFrom(req);
  const fromId = String(req.params.id);
  const b = req.body || {};
  const toId = String(b.toBankId || '');
  const amount = Number(b.amount || 0);

  if (!toId) return res.status(400).json({ error: 'toBankId is required' });
  if (!amount || amount <= 0) return res.status(400).json({ error: 'amount must be > 0' });

  try {
    const [from, to] = await Promise.all([
      Bank.findOne({ where: { id: fromId, tenantId } }),
      Bank.findOne({ where: { id: toId, tenantId } }),
    ]);
    if (!from || !to) return res.status(404).json({ error: 'Bank not found' });

    const t = await sequelize.transaction();
    try {
      const base = {
        tenantId,
        amount,
        currency: (b.currency || from.currency || to.currency || 'TZS').toUpperCase(),
        occurredAt: b.occurredAt ? new Date(b.occurredAt) : new Date(),
        reference: b.reference || null,
        note: b.note || null,
        status: 'posted',
        createdBy: req.user?.id || null,
      };
      await BankTransaction.create({ ...base, bankId: from.id, direction: 'out', type: 'transfer_out' }, { transaction: t });
      await BankTransaction.create({ ...base, bankId: to.id,   direction: 'in',  type: 'transfer_in'  }, { transaction: t });

      await t.commit();
      res.status(201).json({ ok: true });
    } catch (e) {
      await t.rollback();
      if (isMissingTable(e)) return respondMissingTable(res, 'bank transactions');
      res.status(500).json({ error: e.message });
    }
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// POST /api/banks/:id/transfer-to-cash
router.post('/:id/transfer-to-cash', async (req, res) => {
  const { sequelize, Bank, BankTransaction, CashAccount, CashTransaction } = m(req);
  if (!BankTransaction) return respondMissingTable(res, 'bank transactions');
  if (!CashTransaction)  return respondMissingTable(res, 'cash transactions');

  const tenantId = tenantIdFrom(req);
  const fromBankId = String(req.params.id);
  const b = req.body || {};
  const cashId = String(b.cashAccountId || '');
  const amount = Number(b.amount || 0);

  if (!cashId) return res.status(400).json({ error: 'cashAccountId is required' });
  if (!amount || amount <= 0) return res.status(400).json({ error: 'amount must be > 0' });

  try {
    const [bank, cash] = await Promise.all([
      Bank.findOne({ where: { id: fromBankId, tenantId } }),
      CashAccount.findOne({ where: { id: cashId, tenantId } }),
    ]);
    if (!bank || !cash) return res.status(404).json({ error: 'Account not found' });

    const t = await sequelize.transaction();
    try {
      const when = b.occurredAt ? new Date(b.occurredAt) : new Date();
      const currency = (b.currency || bank.currency || cash.currency || 'TZS').toUpperCase();

      await BankTransaction.create({
        tenantId, bankId: bank.id, direction: 'out', type: 'transfer_out',
        amount, currency, occurredAt: when, reference: b.reference || null, note: b.note || null, status: 'posted',
        createdBy: req.user?.id || null,
      }, { transaction: t });

      await CashTransaction.create({
        tenantId, cashAccountId: cash.id, direction: 'in', type: 'transfer_in',
        amount, currency, occurredAt: when, reference: b.reference || null, description: 'Bank→Cash', status: 'posted',
        createdBy: req.user?.id || null,
      }, { transaction: t });

      await t.commit();
      res.status(201).json({ ok: true });
    } catch (e) {
      await t.rollback();
      if (isMissingTable(e)) return respondMissingTable(res, 'cash/bank transactions');
      res.status(500).json({ error: e.message });
    }
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

/* ---------------------- Balance as-of / Overview / Stats ---------------------- */

// GET /api/banks/:id/balance
router.get('/:id/balance', async (req, res) => {
  const { Bank, BankTransaction } = m(req);
  const id = String(req.params.id);

  try {
    const bank = await Bank.findOne({ where: { id, tenantId: tenantIdFrom(req) } });
    if (!bank) return res.status(404).json({ error: 'Bank not found' });

    const asOf = req.query.asOf ? new Date(req.query.asOf) : new Date();

    let inflow = 0, outflow = 0;
    if (BankTransaction) {
      try {
        const sums = await BankTransaction.findAll({
          attributes: [
            [fn('SUM', literal(`CASE WHEN direction='in'  THEN amount ELSE 0 END`)), 'inflow'],
            [fn('SUM', literal(`CASE WHEN direction='out' THEN amount ELSE 0 END`)), 'outflow'],
          ],
          where: { bankId: id, status: 'posted', occurredAt: { [Op.lte]: asOf } },
          raw: true,
        });
        inflow = Number(sums?.[0]?.inflow || 0);
        outflow = Number(sums?.[0]?.outflow || 0);
      } catch (e) {
        if (!isMissingTable(e)) throw e;
      }
    }

    const opening = Number(bank.openingBalance || 0);
    const closing = opening + inflow - outflow;

    return res.json({ asOf: asOf.toISOString(), opening, inflow, outflow, closing });
  } catch (e) {
    if (isMissingTable(e)) return respondMissingTable(res, 'bank transactions');
    return res.status(500).json({ error: e.message });
  }
});

// GET /api/banks/:id/statement
router.get('/:id/statement', async (req, res) => {
  const { BankTransaction, Bank } = m(req);
  const id = String(req.params.id);

  try {
    const bank = await Bank.findOne({ where: { id, tenantId: tenantIdFrom(req) } });
    if (!bank) return res.status(404).json({ error: 'Bank not found' });

    const from = req.query.from ? new Date(req.query.from) : null;
    const to   = req.query.to   ? new Date(req.query.to)   : null;
    const includeOpening = (req.query.includeOpening === '1' || req.query.includeOpening === 'true');

    const range = {};
    if (from) range[Op.gte] = from;
    if (to)   range[Op.lte] = to;

    const where = { bankId: id, tenantId: tenantIdFrom(req) };
    if (from || to) where.occurredAt = range;

    let items = [];
    try {
      if (BankTransaction) {
        items = await BankTransaction.findAll({ where, order: [['occurredAt','ASC'],['createdAt','ASC']] });
      }
    } catch (e) {
      if (!isMissingTable(e)) throw e;
      items = [];
    }

    let openingBalance = Number(bank.openingBalance || 0);
    if (includeOpening && from && BankTransaction) {
      try {
        const before = await BankTransaction.findAll({
          attributes: [
            [fn('SUM', literal(`CASE WHEN direction='in'  THEN amount ELSE 0 END`)), 'inflow'],
            [fn('SUM', literal(`CASE WHEN direction='out' THEN amount ELSE 0 END`)), 'outflow'],
          ],
          where: { bankId: id, tenantId: tenantIdFrom(req), occurredAt: { [Op.lt]: from }, status: 'posted' },
          raw: true,
        });
        const inflow = Number(before?.[0]?.inflow || 0);
        const outflow = Number(before?.[0]?.outflow || 0);
        openingBalance = openingBalance + inflow - outflow;
      } catch (e) {
        if (!isMissingTable(e)) throw e;
      }
    }

    res.json({ bank: { id: bank.id, name: bank.name, currency: bank.currency }, openingBalance, items });
  } catch (e) {
    if (isMissingTable(e)) return respondMissingTable(res, 'bank transactions');
    return res.status(500).json({ error: e.message });
  }
});

// GET /api/banks/__internal/overview
router.get('/__internal/overview', async (req, res) => {
  const { Bank, BankTransaction } = m(req);
  const tenantId = tenantIdFrom(req);

  try {
    const banks = await Bank.findAll({ where: { tenantId }, order: [['name', 'ASC']] });

    const result = [];
    for (const bank of banks) {
      let inflow = 0, outflow = 0;
      if (BankTransaction) {
        try {
          const sums = await BankTransaction.findAll({
            attributes: [
              [fn('SUM', literal(`CASE WHEN direction='in'  THEN amount ELSE 0 END`)), 'inflow'],
              [fn('SUM', literal(`CASE WHEN direction='out' THEN amount ELSE 0 END`)), 'outflow'],
            ],
            where: { bankId: bank.id, status: 'posted' },
            raw: true,
          });
          inflow = Number(sums?.[0]?.inflow || 0);
          outflow = Number(sums?.[0]?.outflow || 0);
        } catch (e) {
          if (!isMissingTable(e)) throw e;
        }
      }
      result.push({
        bankId: bank.id,
        name: bank.name,
        opening: Number(bank.openingBalance || 0),
        inflow,
        outflow,
        current: Number(bank.openingBalance || 0) + inflow - outflow,
        currency: bank.currency,
      });
    }
    res.json({ items: result });
  } catch (e) {
    if (isMissingTable(e)) return respondMissingTable(res, 'bank transactions');
    return res.status(500).json({ error: e.message });
  }
});

// GET /api/banks/__internal/stats/payments
router.get('/__internal/stats/payments', async (req, res) => {
  const { BankTransaction, CashTransaction } = m(req);
  const tenantId = tenantIdFrom(req);
  const from = req.query.from ? new Date(req.query.from) : null;
  const to   = req.query.to   ? new Date(req.query.to)   : null;

  const whereRange = {};
  if (from || to) {
    whereRange.occurredAt = {};
    if (from) whereRange.occurredAt[Op.gte] = from;
    if (to)   whereRange.occurredAt[Op.lte] = to;
  }

  try {
    let bankCount = 0, cashCount = 0;

    if (BankTransaction) {
      try {
        bankCount = await BankTransaction.count({ where: { tenantId, status: 'posted', type: 'loan_repayment', ...whereRange } });
      } catch (e) {
        if (!isMissingTable(e)) throw e;
      }
    }
    if (CashTransaction) {
      try {
        cashCount = await CashTransaction.count({ where: { tenantId, status: 'posted', type: 'loan_repayment', ...whereRange } });
      } catch (e) {
        if (!isMissingTable(e)) throw e;
      }
    }

    res.json({
      from: from ? from.toISOString() : null,
      to:   to ? to.toISOString() : null,
      repayments: { bank: bankCount, cash: cashCount },
    });
  } catch (e) {
    if (isMissingTable(e)) return respondMissingTable(res, 'bank/cash transactions');
    return res.status(500).json({ error: e.message });
  }
});

/* =============================== CASH SUBROUTES =============================== */
const cash = express.Router();

// GET /api/banks/cash/accounts
cash.get('/accounts', async (req, res) => {
  const { CashAccount } = m(req);
  if (!CashAccount) return res.json([]);
  try {
    const rows = await CashAccount.findAll({ where: { tenantId: tenantIdFrom(req) }, order: [['name','ASC']] });
    res.setHeader('X-Total-Count', String(rows.length));
    res.json(rows);
  } catch (e) {
    if (isMissingTable(e)) return res.json([]);
    return res.status(500).json({ error: e.message });
  }
});

// POST /api/banks/cash/accounts
cash.post('/accounts', async (req, res) => {
  const { CashAccount } = m(req);
  if (!CashAccount) return res.status(500).json({ error: 'CashAccount unavailable' });

  try {
    const b = req.body || {};
    const created = await CashAccount.create({
      id: b.id || crypto.randomUUID(),
      tenantId: tenantIdFrom(req),
      name: b.name || 'Main Cash',
      branchId: b.branchId || null,
      openingBalance: Number(b.openingBalance || 0),
      currentBalance: Number(b.currentBalance ?? b.openingBalance ?? 0),
      currency: (b.currency || 'TZS').toUpperCase(),
      isActive: b.isActive !== false,
      meta: b.meta || null,
    });
    res.status(201).json(created);
  } catch (e) {
    if (isMissingTable(e)) return respondMissingTable(res, 'cash accounts');
    return res.status(500).json({ error: e.message });
  }
});

// GET /api/banks/cash/accounts/:id/transactions
cash.get('/accounts/:id/transactions', async (req, res) => {
  const { CashTransaction } = m(req);
  if (!CashTransaction) return res.json([]);
  try {
    const where = { cashAccountId: String(req.params.id), tenantId: tenantIdFrom(req) };
    const rows = await CashTransaction.findAll({ where, order: [['occurredAt','DESC'], ['createdAt','DESC']] });
    res.setHeader('X-Total-Count', String(rows.length));
    res.json(rows);
  } catch (e) {
    if (isMissingTable(e)) return res.json([]);
    return res.status(500).json({ error: e.message });
  }
});

// POST /api/banks/cash/accounts/:id/transactions
cash.post('/accounts/:id/transactions', async (req, res) => {
  const { CashAccount, CashTransaction } = m(req);
  if (!CashTransaction) return respondMissingTable(res, 'cash transactions');

  try {
    const account = await CashAccount.findOne({ where: { id: String(req.params.id), tenantId: tenantIdFrom(req) } });
    if (!account) return res.status(404).json({ error: 'Cash account not found' });

    const b = req.body || {};
    const payload = {
      id: b.id || crypto.randomUUID(),
      tenantId: tenantIdFrom(req),
      cashAccountId: account.id,
      direction: b.direction || (['withdrawal','disbursement','fee','transfer_out'].includes(b.type) ? 'out' : 'in'),
      type: b.type || 'other',
      amount: Number(b.amount || 0),
      currency: (b.currency || account.currency || 'TZS').toUpperCase(),
      occurredAt: b.occurredAt ? new Date(b.occurredAt) : new Date(),
      reference: b.reference || null,
      description: b.description || null,
      status: b.status || 'posted',
      loanId: b.loanId || null,
      borrowerId: b.borrowerId || null,
      createdBy: req.user?.id || null,
      meta: b.meta || null,
    };

    if (!payload.amount || payload.amount <= 0) return res.status(400).json({ error: 'amount must be > 0' });

    const created = await CashTransaction.create(payload);
    res.status(201).json(created);
  } catch (e) {
    if (isMissingTable(e)) return respondMissingTable(res, 'cash transactions');
    return res.status(500).json({ error: e.message });
  }
});

router.use('/cash', cash);

module.exports = router;
