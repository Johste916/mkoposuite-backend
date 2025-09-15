'use strict';

const express = require('express');
const { Op, fn, literal } = require('sequelize');
const crypto = require('crypto');

const router = express.Router();

/* ------------------------------- Model helpers ------------------------------ */
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

// Map the model's createdAt attribute to the actual DB column name
function createdAtField(model) {
  // rawAttributes.createdAt.field is set by our model options; fallback to 'createdAt'
  return model?.rawAttributes?.createdAt?.field || 'createdAt';
}

/* --------------------------------- Errors ---------------------------------- */
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

/* --------------------------------- Codes ----------------------------------- */
// GET /banks/codes
router.get('/codes', async (req, res) => {
  const { Setting } = m(req);
  const tenantId = tenantIdFrom(req);

  const defaults = {
    transactionTypes: [
      'deposit','withdrawal','loan_repayment','disbursement','fee',
      'transfer_in','transfer_out','other'
    ],
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

// GET /banks/codes/:group
router.get('/codes/:group', async (req, res) => {
  const defaults = await new Promise((resolve) => {
    const _res = { json: (x) => resolve(x) };
    router.handle({ ...req, method: 'GET', url: '/codes' }, _res);
  });
  const key = String(req.params.group || '').trim();
  if (!key || !(key in defaults)) return res.json(defaults);
  res.json({ [key]: defaults[key] });
});

/* =============================== BANK ACCOUNTS ============================== */
/* --------------------------------- CRUD ------------------------------------ */

// GET /banks?search=
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

// POST /banks
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

      // legacy mirrors
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

// GET /banks/:id
router.get('/:id', async (req, res) => {
  const { Bank, BankTransaction, sequelize } = m(req);
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

// PUT/PATCH /banks/:id
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

    // legacy mirrors
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

// DELETE /banks/:id
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

/* ========================= GENERIC LISTS / BALANCES ========================= */

// GET /banks/transactions (all banks)
router.get('/transactions', async (req, res) => {
  const { BankTransaction, sequelize } = m(req);
  if (!BankTransaction) return res.json([]);
  try {
    const where = { tenantId: tenantIdFrom(req) };
    if (req.query.status) where.status = String(req.query.status);
    if (req.query.type) where.type = String(req.query.type);

    const rows = await BankTransaction.findAll({
      where,
      order: [
        ['occurredAt','DESC'],
        [sequelize.literal(`"${createdAtField(BankTransaction)}"`), 'DESC'],
      ],
    });
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

// Lightweight list placeholders + /balance
;['transactions','transfers','reconciliation','statements','approvals','rules','import'].forEach(scope => {
  router.get(`/${scope}`, async (_req, res) => res.json({ items: [] }));
  router.get(`/${scope}/balance`, (req, res) => genericBalance(req, res, scope));
});

/* ========================== BANK TX / RECON / IMPORT ======================== */

// GET /banks/:id/transactions
router.get('/:id/transactions', async (req, res) => {
  const { BankTransaction, sequelize } = m(req);
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
    const rows = await BankTransaction.findAll({
      where,
      order: [
        ['occurredAt', 'DESC'],
        [sequelize.literal(`"${createdAtField(BankTransaction)}"`), 'DESC'],
      ],
    });
    res.setHeader('X-Total-Count', String(rows.length));
    return res.json(rows);
  } catch (e) {
    if (isMissingTable(e)) return res.json([]);
    return res.status(500).json({ error: e.message });
  }
});

// POST /banks/:id/transactions
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

// POST /banks/:id/repayments
router.post('/:id/repayments', async (req, res) => {
  const { Bank, BankTransaction } = m(req);
  const bankId = String(req.params.id);
  const tenantId = tenantIdFrom(req);
  const b = req.body || {};

  try {
    if (!b.loanId)  return res.status(400).json({ error: 'loanId is required' });
    if (!b.amount)  return res.status(400).json({ error: 'amount is required' });

    const bank = await Bank.findOne({ where: { id: bankId, tenantId } });
    if (!bank) return res.status(404).json({ error: 'Bank not found' });
    if (!BankTransaction) return respondMissingTable(res, 'bank transactions');

    const created = await BankTransaction.create({
      id: b.id || crypto.randomUUID(),
      tenantId,
      bankId,
      direction: 'in',
      type: 'loan_repayment',
      amount: Number(b.amount),
      currency: (b.currency || bank.currency || 'TZS').toUpperCase(),
      occurredAt: b.occurredAt ? new Date(b.occurredAt) : new Date(),
      reference: b.reference || null,
      status: 'posted',
      loanId: b.loanId,
      borrowerId: b.borrowerId || null,
      createdBy: req.user?.id || null,
      meta: b.meta || null,
    });

    return res.status(201).json(created);
  } catch (e) {
    if (isMissingTable(e)) return respondMissingTable(res, 'bank transactions');
    return res.status(500).json({ error: e.message });
  }
});

/* ----------------------------- Reconciliation ------------------------------ */
// POST /banks/transactions/:txId/reconcile
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

// POST /banks/transactions/:txId/unreconcile
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
// POST /banks/:id/transfer
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
    // Only select the fields we actually need to avoid any stray columns
    const [from, to] = await Promise.all([
      Bank.findOne({ attributes: ['id','currency'], where: { id: fromId, tenantId } }),
      Bank.findOne({ attributes: ['id','currency'], where: { id: toId,   tenantId } }),
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
      await BankTransaction.create(
        { ...base, bankId: from.id, direction: 'out', type: 'transfer_out' },
        { transaction: t, returning: false } // <- avoid RETURNING snakecase surprises
      );
      await BankTransaction.create(
        { ...base, bankId: to.id,   direction: 'in',  type: 'transfer_in'  },
        { transaction: t, returning: false }
      );

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

// POST /banks/:id/transfer-to-cash
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
      Bank.findOne({ attributes: ['id','currency'], where: { id: fromBankId, tenantId } }),
      CashAccount.findOne({ attributes: ['id','currency'], where: { id: cashId, tenantId } }),
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
      }, { transaction: t, returning: false });

      await CashTransaction.create({
        tenantId, cashAccountId: cash.id, direction: 'in', type: 'transfer_in',
        amount, currency, occurredAt: when, reference: b.reference || null, description: 'Bank→Cash', status: 'posted',
        createdBy: req.user?.id || null,
      }, { transaction: t, returning: false });

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

/* ---------------------- Balance-as-of / Statement / Stats ------------------- */

// GET /banks/:id/balance
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

// GET /banks/:id/statement
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

// GET /banks/__internal/overview
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

// GET /banks/__internal/stats/payments
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

/* ============================== CASH SUBROUTES ============================== */

const cash = express.Router();

/* -------- Accounts -------- */
// GET /banks/cash/accounts
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

// POST /banks/cash/accounts
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

/* -------- Transactions -------- */
// GET /banks/cash/accounts/:id/transactions
cash.get('/accounts/:id/transactions', async (req, res) => {
  const { CashTransaction, sequelize } = m(req);
  if (!CashTransaction) return res.json([]);
  try {
    const where = { cashAccountId: String(req.params.id), tenantId: tenantIdFrom(req) };
    if (req.query.type)   where.type = String(req.query.type);
    if (req.query.status) where.status = String(req.query.status);
    if (req.query.from || req.query.to) {
      where.occurredAt = {};
      if (req.query.from) where.occurredAt[Op.gte] = new Date(req.query.from);
      if (req.query.to)   where.occurredAt[Op.lte] = new Date(req.query.to);
    }
    const rows = await CashTransaction.findAll({
      where,
      order: [
        ['occurredAt','DESC'],
        [sequelize.literal(`"${createdAtField(CashTransaction)}"`), 'DESC'],
      ],
    });
    res.setHeader('X-Total-Count', String(rows.length));
    res.json(rows);
  } catch (e) {
    if (isMissingTable(e)) return res.json([]);
    return res.status(500).json({ error: e.message });
  }
});

// POST /banks/cash/accounts/:id/transactions
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
      reconciled: !!b.reconciled,
      reconciledAt: b.reconciled ? (b.reconciledAt ? new Date(b.reconciledAt) : new Date()) : null,
      reconciledBy: b.reconciled ? (req.user?.id || null) : null,
    };

    if (!payload.amount || payload.amount <= 0) return res.status(400).json({ error: 'amount must be > 0' });

    const created = await CashTransaction.create(payload);
    res.status(201).json(created);
  } catch (e) {
    if (isMissingTable(e)) return respondMissingTable(res, 'cash transactions');
    return res.status(500).json({ error: e.message });
  }
});

/* -------- Cash Statement -------- */
// GET /banks/cash/accounts/:id/statement
cash.get('/accounts/:id/statement', async (req, res) => {
  const { CashTransaction, CashAccount } = m(req);
  const id = String(req.params.id);

  try {
    const account = await CashAccount.findOne({ where: { id, tenantId: tenantIdFrom(req) } });
    if (!account) return res.status(404).json({ error: 'Cash account not found' });

    const from = req.query.from ? new Date(req.query.from) : null;
    const to   = req.query.to   ? new Date(req.query.to)   : null;
    const includeOpening = (req.query.includeOpening === '1' || req.query.includeOpening === 'true');

    const range = {};
    if (from) range[Op.gte] = from;
    if (to)   range[Op.lte] = to;

    const where = { cashAccountId: id, tenantId: tenantIdFrom(req) };
    if (from || to) where.occurredAt = range;

    let items = [];
    try {
      if (CashTransaction) {
        items = await CashTransaction.findAll({ where, order: [['occurredAt','ASC'],['createdAt','ASC']] });
      }
    } catch (e) {
      if (!isMissingTable(e)) throw e;
      items = [];
    }

    let openingBalance = Number(account.openingBalance || 0);
    if (includeOpening && from && CashTransaction) {
      try {
        const before = await CashTransaction.findAll({
          attributes: [
            [fn('SUM', literal(`CASE WHEN direction='in'  THEN amount ELSE 0 END`)), 'inflow'],
            [fn('SUM', literal(`CASE WHEN direction='out' THEN amount ELSE 0 END`)), 'outflow'],
          ],
          where: { cashAccountId: id, tenantId: tenantIdFrom(req), occurredAt: { [Op.lt]: from }, status: 'posted' },
          raw: true,
        });
        const inflow = Number(before?.[0]?.inflow || 0);
        const outflow = Number(before?.[0]?.outflow || 0);
        openingBalance = openingBalance + inflow - outflow;
      } catch (e) {
        if (!isMissingTable(e)) throw e;
      }
    }

    res.json({ account: { id: account.id, name: account.name, currency: account.currency }, openingBalance, items });
  } catch (e) {
    if (isMissingTable(e)) return respondMissingTable(res, 'cash transactions');
    return res.status(500).json({ error: e.message });
  }
});

/* -------- Cash Balance-as-of -------- */
// GET /banks/cash/accounts/:id/balance
cash.get('/accounts/:id/balance', async (req, res) => {
  const { CashAccount, CashTransaction } = m(req);
  const id = String(req.params.id);

  try {
    const account = await CashAccount.findOne({ where: { id, tenantId: tenantIdFrom(req) } });
    if (!account) return res.status(404).json({ error: 'Cash account not found' });

    const asOf = req.query.asOf ? new Date(req.query.asOf) : new Date();

    let inflow = 0, outflow = 0;
    if (CashTransaction) {
      try {
        const sums = await CashTransaction.findAll({
          attributes: [
            [fn('SUM', literal(`CASE WHEN direction='in'  THEN amount ELSE 0 END`)), 'inflow'],
            [fn('SUM', literal(`CASE WHEN direction='out' THEN amount ELSE 0 END`)), 'outflow'],
          ],
          where: { cashAccountId: id, status: 'posted', occurredAt: { [Op.lte]: asOf } },
          raw: true,
        });
        inflow = Number(sums?.[0]?.inflow || 0);
        outflow = Number(sums?.[0]?.outflow || 0);
      } catch (e) {
        if (!isMissingTable(e)) throw e;
      }
    }

    const opening = Number(account.openingBalance || 0);
    const closing = opening + inflow - outflow;

    return res.json({ asOf: asOf.toISOString(), opening, inflow, outflow, closing });
  } catch (e) {
    if (isMissingTable(e)) return respondMissingTable(res, 'cash transactions');
    return res.status(500).json({ error: e.message });
  }
});

/* -------- Cash Reconciliation -------- */
// POST /banks/cash/transactions/:txId/reconcile
cash.post('/transactions/:txId/reconcile', async (req, res) => {
  const { CashTransaction } = m(req);
  if (!CashTransaction) return respondMissingTable(res, 'cash transactions');
  try {
    const txId = String(req.params.txId);
    const tx = await CashTransaction.findOne({ where: { id: txId, tenantId: tenantIdFrom(req) } });
    if (!tx) return res.status(404).json({ error: 'Transaction not found' });

    await tx.update({
      reconciled: true,
      reconciledAt: new Date(),
      reconciledBy: req.user?.id || null,
      note: req.body?.note ?? tx.note,
    });
    res.json(tx);
  } catch (e) {
    if (isMissingTable(e)) return respondMissingTable(res, 'cash transactions');
    return res.status(500).json({ error: e.message });
  }
});

// POST /banks/cash/transactions/:txId/unreconcile
cash.post('/transactions/:txId/unreconcile', async (req, res) => {
  const { CashTransaction } = m(req);
  if (!CashTransaction) return respondMissingTable(res, 'cash transactions');
  try {
    const txId = String(req.params.txId);
    const tx = await CashTransaction.findOne({ where: { id: txId, tenantId: tenantIdFrom(req) } });
    if (!tx) return res.status(404).json({ error: 'Transaction not found' });

    await tx.update({ reconciled: false, reconciledAt: null, reconciledBy: null, note: req.body?.note ?? tx.note });
    res.json(tx);
  } catch (e) {
    if (isMissingTable(e)) return respondMissingTable(res, 'cash transactions');
    return res.status(500).json({ error: e.message });
  }
});

/* -------- Cash Approvals -------- */
// GET /banks/cash/transactions/pending
cash.get('/transactions/pending', async (req, res) => {
  const { CashTransaction, sequelize } = m(req);
  if (!CashTransaction) return res.json([]);
  try {
    const where = { tenantId: tenantIdFrom(req), status: 'pending' };
    const rows = await CashTransaction.findAll({
      where,
      order: [
        ['occurredAt','DESC'],
        [sequelize.literal(`"${createdAtField(CashTransaction)}"`), 'DESC'],
      ],
    });
    res.setHeader('X-Total-Count', String(rows.length));
    res.json(rows);
  } catch (e) {
    if (isMissingTable(e)) return res.json([]);
    return res.status(500).json({ error: e.message });
  }
});

// Wire cash subrouter
router.use('/cash', cash);

/* ======================= BANKING APPROVALS (maker-checker) ================== */

// GET /banks/transactions/pending
router.get('/transactions/pending', async (req, res) => {
  const { BankTransaction, sequelize } = m(req);
  if (!BankTransaction) return res.json([]);
  try {
    const where = { tenantId: tenantIdFrom(req), status: 'pending' };
    const rows = await BankTransaction.findAll({
      where,
      order: [
        ['occurredAt','DESC'],
        [sequelize.literal(`"${createdAtField(BankTransaction)}"`), 'DESC'],
      ],
    });
    res.setHeader('X-Total-Count', String(rows.length));
    res.json(rows);
  } catch (e) {
    if (isMissingTable(e)) return res.json([]);
    return res.status(500).json({ error: e.message });
  }
});

// POST /banks/transactions/:txId/approve
router.post('/transactions/:txId/approve', async (req, res) => {
  const { BankTransaction } = m(req);
  if (!BankTransaction) return respondMissingTable(res, 'bank transactions');
  try {
    const tx = await BankTransaction.findOne({ where: { id: String(req.params.txId), tenantId: tenantIdFrom(req) } });
    if (!tx) return res.status(404).json({ error: 'Transaction not found' });
    await tx.update({ status: 'posted', approvedBy: req.user?.id || null, approvedAt: new Date() });
    res.json(tx);
  } catch (e) {
    if (isMissingTable(e)) return respondMissingTable(res, 'bank transactions');
    return res.status(500).json({ error: e.message });
  }
});

// POST /banks/transactions/:txId/reject
router.post('/transactions/:txId/reject', async (req, res) => {
  const { BankTransaction } = m(req);
  if (!BankTransaction) return respondMissingTable(res, 'bank transactions');
  try {
    const tx = await BankTransaction.findOne({ where: { id: String(req.params.txId), tenantId: tenantIdFrom(req) } });
    if (!tx) return res.status(404).json({ error: 'Transaction not found' });
    await tx.update({ status: 'void', rejectionReason: req.body?.reason || null, rejectedBy: req.user?.id || null, rejectedAt: new Date() });
    res.json(tx);
  } catch (e) {
    if (isMissingTable(e)) return respondMissingTable(res, 'bank transactions');
    return res.status(500).json({ error: e.message });
  }
});

/* ============================ RULES & GL MAPPING ============================ */

// GET /banks/rules/gl-mapping
router.get('/rules/gl-mapping', async (req, res) => {
  const { Setting } = m(req);
  const tenantId = tenantIdFrom(req);
  if (!Setting) return res.json({ bank: {}, cash: {} });
  try {
    const row = await Setting.findOne({ where: { key: 'bank.glMapping', tenantId } });
    const value = row?.value ? (typeof row.value === 'string' ? JSON.parse(row.value) : row.value) : { bank: {}, cash: {} };
    res.json(value);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// PUT /banks/rules/gl-mapping
router.put('/rules/gl-mapping', async (req, res) => {
  const { Setting } = m(req);
  const tenantId = tenantIdFrom(req);
  if (!Setting) return res.status(500).json({ error: 'Setting model unavailable' });
  try {
    const value = (req.body && typeof req.body === 'object') ? req.body : {};
    const [row, created] = await Setting.findOrCreate({
      where: { key: 'bank.glMapping', tenantId },
      defaults: { key: 'bank.glMapping', tenantId, value }
    });
    if (!created) await row.update({ value });
    res.json({ ok: true, value });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

/* ============================== IMPORT BANK CSV ============================= */

// POST /banks/:id/import
router.post('/:id/import', async (req, res) => {
  const { Bank, BankTransaction, sequelize } = m(req);
  const tenantId = tenantIdFrom(req);
  const bankId = String(req.params.id);

  if (!BankTransaction) return respondMissingTable(res, 'bank transactions');

  try {
    const bank = await Bank.findOne({ attributes: ['id','currency'], where: { id: bankId, tenantId } });
    if (!bank) return res.status(404).json({ error: 'Bank not found' });

    const rows = Array.isArray(req.body?.rows) ? req.body.rows : null;
    if (!rows || !rows.length) return res.status(400).json({ error: 'rows[] is required' });

    const t = await sequelize.transaction();
    try {
      let count = 0;
      for (const r of rows) {
        const type = String(r.type || 'other');
        const direction = r.direction ||
          (['withdrawal','disbursement','fee','transfer_out'].includes(type) ? 'out' : 'in');

        const payload = {
          id: r.id || crypto.randomUUID(),
          tenantId,
          bankId: bank.id,
          direction,
          type,
          amount: Number(r.amount || 0),
          currency: (r.currency || bank.currency || 'TZS').toUpperCase(),
          occurredAt: r.occurredAt ? new Date(r.occurredAt) : new Date(),
          reference: r.reference || null,
          bankRef: r.bankRef || null,
          description: r.description || null,
          note: r.note || null,
          status: r.status || 'posted',
          loanId: r.loanId || null,
          borrowerId: r.borrowerId || null,
          createdBy: req.user?.id || null,
          meta: r.meta || null,
        };

        if (!payload.amount || payload.amount <= 0) {
          await t.rollback();
          return res.status(400).json({ error: 'Each row amount must be > 0' });
        }

        await BankTransaction.create(payload, { transaction: t, returning: false });
        count += 1;
      }

      await t.commit();
      res.status(201).json({ ok: true, created: count });
    } catch (e) {
      await t.rollback();
      if (isMissingTable(e)) return respondMissingTable(res, 'bank transactions');
      res.status(500).json({ error: e.message });
    }
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

/* --------------------------------- EXPORT ---------------------------------- */
module.exports = router;
