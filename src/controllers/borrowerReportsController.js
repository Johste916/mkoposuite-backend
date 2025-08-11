const { Op } = require('sequelize');
const models = require('../models');

const Borrower = models.Borrower || null;
const Loan = models.Loan || null;

const safeNum = (v) => Number(v || 0);

exports.getBorrowerSummary = async (req, res) => {
  try {
    // Default safe response
    let result = {
      activeBorrowers: 0,
      totalOutstanding: 0,
      par: 0
    };

    // Active borrowers
    if (Borrower) {
      result.activeBorrowers = await Borrower.count({ where: { status: 'active' } });
    }

    // Total outstanding = sum of balances on active loans
    if (Loan) {
      const activeLoans = await Loan.findAll({ where: { status: 'active' } });
      result.totalOutstanding = activeLoans.reduce((sum, l) => sum + safeNum(l.balance), 0);

      // Portfolio at Risk (PAR) for overdue loans
      const overdueLoans = activeLoans.filter(l => l.dueDate && l.dueDate < new Date() && safeNum(l.balance) > 0);
      const overdueAmount = overdueLoans.reduce((sum, l) => sum + safeNum(l.balance), 0);

      result.par = result.totalOutstanding > 0
        ? Number(((overdueAmount / result.totalOutstanding) * 100).toFixed(2))
        : 0;
    }

    return res.json(result);
  } catch (error) {
    console.error('getBorrowerSummary error:', error);
    return res.json({
      activeBorrowers: 0,
      totalOutstanding: 0,
      par: 0
    });
  }
};
