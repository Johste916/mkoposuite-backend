// controllers/dashboardController.js
const { Borrower, Loan, LoanRepayment } = require('../models');

// GET /api/dashboard/summary
exports.getDashboardSummary = async (req, res) => {
  try {
    const totalBorrowers = await Borrower.count();
    const totalLoans = await Loan.count();

    const totalPaid = await LoanRepayment.sum('total') || 0;
    const totalRepaid = await LoanRepayment.sum('balance') || 0;

    res.json({
      totalBorrowers,
      totalLoans,
      totalPaid,
      totalRepaid
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
          attributes: ['id', 'amount', 'borrowerId'], // removed termMonths
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
