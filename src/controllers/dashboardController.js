// controllers/dashboardController.js
const { Borrower, Loan, LoanRepayment, SavingsTransaction } = require('../models');
const { Op } = require('sequelize');
const { startOfMonth, endOfMonth } = require('date-fns');

// GET /api/dashboard/summary
exports.getDashboardSummary = async (req, res) => {
  try {
    const [totalBorrowers, totalLoans, totalPaid, totalRepaid, savingsTxs] = await Promise.all([
      Borrower.count(),
      Loan.count(),
      LoanRepayment.sum('total') || 0,
      LoanRepayment.sum('balance') || 0,
      SavingsTransaction.findAll()
    ]);

    let totalDeposits = 0;
    let totalWithdrawals = 0;

    for (let tx of savingsTxs) {
      if (tx.type === 'deposit') totalDeposits += tx.amount;
      else if (tx.type === 'withdrawal') totalWithdrawals += tx.amount;
    }

    res.json({
      totalBorrowers,
      totalLoans,
      totalPaid,
      totalRepaid,
      totalDeposits,
      totalWithdrawals,
      netSavings: totalDeposits - totalWithdrawals,
    });
  } catch (error) {
    console.error('Dashboard summary error:', error.message);
    res.status(500).json({ message: 'Failed to fetch summary' });
  }
};

// GET /api/dashboard/defaulters
exports.getDefaulters = async (req, res) => {
  try {
    const defaulters = await LoanRepayment.findAll({
      where: { status: 'overdue' },
      include: [
        {
          model: Loan,
          attributes: ['id', 'amount', 'borrowerId'],
          include: [
            {
              model: Borrower,
              attributes: ['name', 'phone', 'email']
            }
          ]
        }
      ]
    });

    const result = defaulters.map(item => ({
      name: item?.Loan?.Borrower?.name || 'Unknown',
      phone: item?.Loan?.Borrower?.phone || '',
      email: item?.Loan?.Borrower?.email || '',
      overdueAmount: parseFloat(item.total || 0)
    }));

    res.json(result);
  } catch (error) {
    console.error('Defaulters fetch error:', error.message);
    res.status(500).json({ message: 'Failed to fetch defaulters' });
  }
};

// GET /api/dashboard/monthly-trends
exports.getMonthlyTrends = async (req, res) => {
  try {
    const now = new Date();
    const start = startOfMonth(now);
    const end = endOfMonth(now);

    const [monthlyLoans, monthlyDeposits, monthlyRepayments] = await Promise.all([
      Loan.count({ where: { createdAt: { [Op.between]: [start, end] } } }),
      SavingsTransaction.sum('amount', {
        where: { type: 'deposit', date: { [Op.between]: [start, end] } }
      }),
      LoanRepayment.sum('amountPaid', {
        where: { date: { [Op.between]: [start, end] } }
      }),
    ]);

    res.json({
      month: now.toLocaleString('default', { month: 'long' }),
      year: now.getFullYear(),
      monthlyLoans,
      monthlyDeposits: monthlyDeposits || 0,
      monthlyRepayments: monthlyRepayments || 0,
    });
  } catch (error) {
    console.error('Monthly trends error:', error.message);
    res.status(500).json({ message: 'Failed to fetch monthly data' });
  }
};
