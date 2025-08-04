// controllers/repaymentController.js
const { LoanRepayment, Loan, Borrower } = require('../models');

// Get all repayments
exports.getAllRepayments = async (req, res) => {
  try {
    const repayments = await LoanRepayment.findAll({
      include: {
        model: Loan,
        include: [{ model: Borrower }],
      },
      order: [['dueDate', 'ASC']],
    });
    res.json(repayments);
  } catch (err) {
    console.error('Fetch repayments error:', err);
    res.status(500).json({ error: 'Failed to fetch repayments' });
  }
};

// Get repayments for a specific borrower
exports.getRepaymentsByBorrower = async (req, res) => {
  try {
    const { borrowerId } = req.params;
    const repayments = await LoanRepayment.findAll({
      include: {
        model: Loan,
        where: { borrowerId },
        include: [{ model: Borrower }],
      },
    });
    res.json(repayments);
  } catch (err) {
    res.status(500).json({ error: 'Error fetching borrower repayments' });
  }
};

// Manual repayment creation (Admin only)
exports.createRepayment = async (req, res) => {
  try {
    const { role } = req.user;
    if (role !== 'Admin') return res.status(403).json({ error: 'Only Admins can record repayments' });

    const {
      loanId,
      installmentNumber,
      dueDate,
      principal,
      interest,
      total,
      balance,
      status,
    } = req.body;

    const repayment = await LoanRepayment.create({
      loanId,
      installmentNumber,
      dueDate,
      principal,
      interest,
      total,
      balance,
      status,
    });

    res.status(201).json(repayment);
  } catch (err) {
    console.error('Create repayment error:', err);
    res.status(500).json({ error: 'Error saving repayment' });
  }
};
