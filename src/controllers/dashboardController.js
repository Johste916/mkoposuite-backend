// backend/src/controllers/dashboardController.js
const { Loan, LoanRepayment, Borrower, Branch, User } = require('../models');
const { Op } = require('sequelize');

// ✅ Clean and aligned with frontend expectations
exports.getDashboardSummary = async (req, res) => {
  try {
    const totalLoans = await Loan.count();
    const disbursed = await Loan.count({ where: { status: 'disbursed' } });
    const approved = await Loan.count({ where: { status: 'approved' } });

    const totalPaid = await LoanRepayment.sum('amountPaid') || 0;
    const totalLoanAmount = await Loan.sum('amount') || 0;
    const totalOutstanding = totalLoanAmount - totalPaid;

    const defaulters = await LoanRepayment.count({
      where: {
        dueDate: { [Op.lt]: new Date() },
        isPaid: false
      }
    });

    res.json({
      totalLoans,
      disbursed,
      approved,
      totalPaid,
      totalOutstanding,
      defaulters
    });
  } catch (err) {
    console.error('Dashboard summary error:', err);
    res.status(500).json({ message: 'Server error' });
  }
};

exports.getDefaulters = async (req, res) => {
  try {
    const defaulters = await LoanRepayment.findAll({
      where: {
        dueDate: { [Op.lt]: new Date() },
        isPaid: false
      },
      include: [{ model: Loan, include: [Borrower, Branch] }]
    });

    const formatted = defaulters.map(d => ({
      borrower: d.Loan?.Borrower?.name || 'Unknown',
      phone: d.Loan?.Borrower?.phone || 'N/A',
      branch: d.Loan?.Branch?.name || 'N/A',
      dueDate: d.dueDate,
      amount: d.amountDue
    }));

    res.json(formatted);
  } catch (err) {
    console.error('Defaulters error:', err);
    res.status(500).json({ message: 'Server error' });
  }
};