// controllers/savingsController.js
'use strict';
const { SavingsTransaction } = require('../models');

// Record a deposit, withdrawal, charge, or interest (starts as PENDING)
exports.createTransaction = async (req, res) => {
  try {
    const { borrowerId, type, amount, date, notes } = req.body;

    const validTypes = ['deposit', 'withdrawal', 'charge', 'interest'];
    if (!validTypes.includes(type)) {
      return res.status(400).json({ error: 'Invalid transaction type' });
    }
    if (!borrowerId || !amount || !date) {
      return res.status(400).json({ error: 'borrowerId, amount and date are required' });
    }

    const transaction = await SavingsTransaction.create({
      borrowerId,
      type,
      amount,
      date,
      notes,
      status: 'pending',
      createdBy: req.user?.id ? String(req.user.id) : null,
    });

    res.status(201).json(transaction);
  } catch (err) {
    console.error('Error creating savings transaction:', err);
    res.status(500).json({ error: 'Failed to create savings transaction' });
  }
};

// Get savings transactions with filter and summary
// NOTE: only APPROVED transactions contribute to balance/summary by default.
exports.getSavingsByBorrower = async (req, res) => {
  try {
    const borrowerId = req.params.borrowerId;
    const { type, includePending } = req.query;

    const where = { borrowerId };
    if (type && ['deposit', 'withdrawal', 'charge', 'interest'].includes(type)) {
      where.type = type;
    }
    if (!includePending) {
      // Only approved affect balances
      where.status = 'approved';
    }

    const transactions = await SavingsTransaction.findAll({
      where,
      order: [['date', 'ASC']],
    });

    const balance = transactions.reduce((total, tx) => {
      if (tx.reversed) return total;
      if (tx.type === 'deposit' || tx.type === 'interest') return total + Number(tx.amount || 0);
      if (tx.type === 'withdrawal' || tx.type === 'charge') return total - Number(tx.amount || 0);
      return total;
    }, 0);

    const totals = { deposits: 0, withdrawals: 0, charges: 0, interest: 0 };
    transactions.forEach((tx) => {
      if (tx.reversed) return;
      const amt = Number(tx.amount || 0);
      if (tx.type === 'deposit') totals.deposits += amt;
      if (tx.type === 'withdrawal') totals.withdrawals += amt;
      if (tx.type === 'charge') totals.charges += amt;
      if (tx.type === 'interest') totals.interest += amt;
    });

    res.json({ transactions, balance, totals });
  } catch (err) {
    console.error('Error fetching savings:', err);
    res.status(500).json({ error: 'Failed to fetch savings' });
  }
};
