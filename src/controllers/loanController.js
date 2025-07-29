const { Loan, Borrower } = require('../models');

// Create Loan
exports.createLoan = async (req, res) => {
  try {
    const loan = await Loan.create(req.body);
    res.status(201).json(loan);
  } catch (err) {
    console.error('Create loan error:', err);
    res.status(500).json({ error: 'Failed to create loan' });
  }
};

// Get All Loans
exports.getAllLoans = async (req, res) => {
  try {
    const loans = await Loan.findAll({ include: Borrower });
    res.json(loans);
  } catch (err) {
    console.error('Fetch loans error:', err);
    res.status(500).json({ error: 'Failed to fetch loans' });
  }
};

// Get Single Loan
exports.getLoanById = async (req, res) => {
  try {
    const loan = await Loan.findByPk(req.params.id, { include: Borrower });
    if (!loan) return res.status(404).json({ error: 'Loan not found' });
    res.json(loan);
  } catch (err) {
    res.status(500).json({ error: 'Error fetching loan' });
  }
};

// Update Loan
exports.updateLoan = async (req, res) => {
  try {
    const loan = await Loan.findByPk(req.params.id);
    if (!loan) return res.status(404).json({ error: 'Loan not found' });

    await loan.update(req.body);
    res.json(loan);
  } catch (err) {
    res.status(500).json({ error: 'Error updating loan' });
  }
};

// Delete Loan
exports.deleteLoan = async (req, res) => {
  try {
    const loan = await Loan.findByPk(req.params.id);
    if (!loan) return res.status(404).json({ error: 'Loan not found' });

    await loan.destroy();
    res.json({ message: 'Loan deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Error deleting loan' });
  }
};
