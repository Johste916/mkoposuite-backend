const { SavingsTransaction, Borrower } = require('../models');
const { Op } = require('sequelize');

// Record a deposit, withdrawal, charge, or interest
exports.createTransaction = async (req, res) => {
  try {
    const { borrowerId, type, amount, date, notes } = req.body;

    const validTypes = ['deposit', 'withdrawal', 'charge', 'interest'];
    if (!validTypes.includes(type)) {
      return res.status(400).json({ error: 'Invalid transaction type' });
    }

    const transaction = await SavingsTransaction.create({
      borrowerId,
      type,
      amount,
      date,
      notes,
    });

    res.status(201).json(transaction);
  } catch (err) {
    console.error('Error creating savings transaction:', err);
    res.status(500).json({ error: 'Failed to create savings transaction' });
  }
};

// Get savings transactions with filter and summary
exports.getSavingsByBorrower = async (req, res) => {
  try {
    const borrowerId = req.params.borrowerId;
    const { type } = req.query;

    const where = { borrowerId };
    if (type && ['deposit', 'withdrawal', 'charge', 'interest'].includes(type)) {
      where.type = type;
    }

    const transactions = await SavingsTransaction.findAll({
      where,
      order: [['date', 'ASC']],
    });

    const balance = transactions.reduce((total, tx) => {
      if (tx.reversed) return total;
      if (tx.type === 'deposit' || tx.type === 'interest') return total + tx.amount;
      if (tx.type === 'withdrawal' || tx.type === 'charge') return total - tx.amount;
      return total;
    }, 0);

    const totals = {
      deposits: 0,
      withdrawals: 0,
      charges: 0,
      interest: 0,
    };

    transactions.forEach((tx) => {
      if (tx.reversed) return;
      if (tx.type === 'deposit') totals.deposits += tx.amount;
      if (tx.type === 'withdrawal') totals.withdrawals += tx.amount;
      if (tx.type === 'charge') totals.charges += tx.amount;
      if (tx.type === 'interest') totals.interest += tx.amount;
    });

    res.json({ transactions, balance, totals });
  } catch (err) {
    console.error('Error fetching savings:', err);
    res.status(500).json({ error: 'Failed to fetch savings' });
  }
};
