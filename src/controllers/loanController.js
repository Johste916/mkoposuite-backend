// backend/src/controllers/loanController.js

const { Loan, User, LoanRepayment } = require('../../models');
const moment = require('moment');

// Create a new loan
exports.createLoan = async (req, res) => {
  try {
    const loan = await Loan.create(req.body);
    res.status(201).json(loan);
  } catch (err) {
    console.error('Create loan error:', err);
    res.status(500).json({ error: 'Failed to create loan.' });
  }
};

// Get all loans with related user and repayments
exports.getLoans = async (req, res) => {
  try {
    const loans = await Loan.findAll({
      include: [
        { model: User, as: 'user' },
        { model: LoanRepayment, as: 'repayments' }
      ]
    });
    res.json(loans);
  } catch (err) {
    console.error('Get loans error:', err);
    res.status(500).json({ error: 'Failed to fetch loans.' });
  }
};

// Get single loan by ID
exports.getLoanById = async (req, res) => {
  try {
    const loan = await Loan.findByPk(req.params.id, {
      include: [
        { model: User, as: 'user' },
        { model: LoanRepayment, as: 'repayments' }
      ]
    });
    if (!loan) return res.status(404).json({ error: 'Loan not found' });
    res.json(loan);
  } catch (err) {
    console.error('Get loan by ID error:', err);
    res.status(500).json({ error: 'Failed to fetch loan.' });
  }
};

// Update loan details
exports.updateLoan = async (req, res) => {
  try {
    const loan = await Loan.findByPk(req.params.id);
    if (!loan) return res.status(404).json({ error: 'Loan not found' });

    await loan.update(req.body);
    res.json(loan);
  } catch (err) {
    console.error('Update loan error:', err);
    res.status(500).json({ error: 'Failed to update loan.' });
  }
};

// Delete a loan
exports.deleteLoan = async (req, res) => {
  try {
    const loan = await Loan.findByPk(req.params.id);
    if (!loan) return res.status(404).json({ error: 'Loan not found' });

    await loan.destroy();
    res.json({ message: 'Loan deleted.' });
  } catch (err) {
    console.error('Delete loan error:', err);
    res.status(500).json({ error: 'Failed to delete loan.' });
  }
};

// Disburse a loan (new)
exports.disburseLoan = async (req, res) => {
  try {
    const loan = await Loan.findByPk(req.params.id);
    if (!loan) return res.status(404).json({ error: 'Loan not found' });

    if (loan.status === 'disbursed') {
      return res.status(400).json({ error: 'Loan already disbursed' });
    }

    await loan.update({
      status: 'disbursed',
      disbursedAt: moment().toDate()
    });

    res.json({ message: 'Loan disbursed successfully', loan });
  } catch (err) {
    console.error('Disburse loan error:', err);
    res.status(500).json({ error: 'Failed to disburse loan.' });
  }
};
