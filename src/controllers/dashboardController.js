const { Borrower, Loan, LoanRepayment, SavingsTransaction, User, Branch } = require('../models');
const { Op } = require('sequelize');
const {
  startOfDay,
  endOfDay,
  startOfWeek,
  endOfWeek,
  startOfMonth,
  endOfMonth,
  startOfQuarter,
  endOfQuarter,
  startOfYear,
  endOfYear,
  parseISO
} = require('date-fns');

// Helper to compute date range
const getDateRange = (timeRange, startDate, endDate) => {
  const now = new Date();
  switch (timeRange) {
    case 'today':
      return [startOfDay(now), endOfDay(now)];
    case 'week':
      return [startOfWeek(now), endOfWeek(now)];
    case 'month':
      return [startOfMonth(now), endOfMonth(now)];
    case 'quarter':
      return [startOfQuarter(now), endOfQuarter(now)];
    case 'semiAnnual':
      const month = now.getMonth();
      if (month < 6) {
        return [new Date(now.getFullYear(), 0, 1), new Date(now.getFullYear(), 5, 30)];
      } else {
        return [new Date(now.getFullYear(), 6, 1), new Date(now.getFullYear(), 11, 31)];
      }
    case 'annual':
      return [startOfYear(now), endOfYear(now)];
    case 'custom':
      return [parseISO(startDate), parseISO(endDate)];
    default:
      return [null, null];
  }
};

// GET /api/dashboard/summary
exports.getDashboardSummary = async (req, res) => {
  try {
    const { branchId, officerId, timeRange, startDate, endDate } = req.query;

    const loanFilter = {};
    const repaymentFilter = {};
    const borrowerFilter = {};
    const savingsFilter = {};

    if (branchId) {
      loanFilter.branchId = branchId;
      borrowerFilter.branchId = branchId;
    }
    if (officerId) {
      loanFilter.initiatedBy = officerId;
    }

    const [start, end] = getDateRange(timeRange, startDate, endDate);

    if (start && end) {
      loanFilter.createdAt = { [Op.between]: [start, end] };
      repaymentFilter.date = { [Op.between]: [start, end] };
      savingsFilter.date = { [Op.between]: [start, end] };
      loanFilter.disbursementDate = { [Op.between]: [start, end] };
    }

    const [
      totalBorrowers,
      totalLoans,
      totalPaid,
      totalRepaid,
      totalExpectedRepayments,
      savingsTxs,
      totalDisbursed,
      approvedLoans,
      disbursedLoans,
      pendingLoans,
      rejectedLoans,
      writtenOffLoans,
      defaultedPrincipal,
      defaultedInterest,
      outstandingPrincipal
    ] = await Promise.all([
      Borrower.count({ where: borrowerFilter }),
      Loan.count({ where: loanFilter }),
      LoanRepayment.sum('total', { where: repaymentFilter }) || 0,
      LoanRepayment.sum('balance', { where: repaymentFilter }) || 0,
      LoanRepayment.sum('amount', { where: repaymentFilter }) || 0,
      SavingsTransaction.findAll({ where: savingsFilter }),
      Loan.sum('amount', { where: { ...loanFilter, status: 'disbursed' } }) || 0,

      Loan.count({ where: { ...loanFilter, status: 'approved' } }),
      Loan.count({ where: { ...loanFilter, status: 'disbursed' } }),
      Loan.count({ where: { ...loanFilter, status: 'pending' } }),
      Loan.count({ where: { ...loanFilter, status: 'rejected' } }),

      Loan.count({ where: { ...loanFilter, status: 'written-off' } }),

      LoanRepayment.sum('principal', { where: { ...repaymentFilter, status: 'overdue' } }) || 0,
      LoanRepayment.sum('interest', { where: { ...repaymentFilter, status: 'overdue' } }) || 0,

      LoanRepayment.sum('principal', { where: repaymentFilter }) || 0
    ]);

    let totalDeposits = 0;
    let totalWithdrawals = 0;
    for (let tx of savingsTxs) {
      if (tx.type === 'deposit') totalDeposits += tx.amount;
      else if (tx.type === 'withdrawal') totalWithdrawals += tx.amount;
    }

    const netSavings = totalDeposits - totalWithdrawals;
    const PAR = outstandingPrincipal > 0 ? (defaultedPrincipal / outstandingPrincipal) * 100 : 0;

    res.json({
      totalBorrowers,
      totalLoans,
      totalPaid,
      totalRepaid,
      totalExpectedRepayments,
      totalDeposits,
      totalWithdrawals,
      netSavings,
      totalDisbursed,

      approvedLoans,
      disbursedLoans,
      pendingLoans,
      rejectedLoans,

      writtenOffLoans,
      defaultedPrincipal,
      defaultedInterest,
      PAR: parseFloat(PAR.toFixed(2)),

      companyMessage: 'Welcome to MkopoSuite LMS - Quarter 3 focus: Risk Reduction!'
    });
  } catch (error) {
    console.error('Dashboard summary error:', error.message);
    res.status(500).json({ message: 'Failed to fetch summary' });
  }
};

// GET /api/dashboard/defaulters
exports.getDefaulters = async (req, res) => {
  try {
    const { branchId, officerId } = req.query;

    const whereLoan = {};
    if (branchId) whereLoan.branchId = branchId;
    if (officerId) whereLoan.initiatedBy = officerId;

    const defaulters = await LoanRepayment.findAll({
      where: { status: 'overdue' },
      include: [
        {
          model: Loan,
          attributes: ['id', 'amount', 'borrowerId'],
          where: whereLoan,
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
      })
    ]);

    res.json({
      month: now.toLocaleString('default', { month: 'long' }),
      year: now.getFullYear(),
      monthlyLoans,
      monthlyDeposits: monthlyDeposits || 0,
      monthlyRepayments: monthlyRepayments || 0
    });
  } catch (error) {
    console.error('Monthly trends error:', error.message);
    res.status(500).json({ message: 'Failed to fetch monthly data' });
  }
};
