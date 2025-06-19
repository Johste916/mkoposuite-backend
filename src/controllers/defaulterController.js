// backend/src/controllers/defaulterController.js

const { Loan, User, LoanRepayment } = require('../models');
const { Op } = require('sequelize');

exports.getDefaulters = async (req, res) => {
  try {
    const defaulters = await LoanRepayment.findAll({
      where: {
        status: 'overdue'
      },
      include: [
        {
          model: Loan,
          as: 'loan',
          include: [{ model: User, as: 'user' }]
        }
      ],
      order: [['dueDate', 'ASC']]
    });

    const formatted = defaulters.map((d) => ({
      id: d.id,
      loanId: d.loan?.id,
      borrowerName: d.loan?.user?.name,
      dueDate: d.dueDate,
      status: d.status
    }));

    res.json(formatted);
  } catch (err) {
    console.error('Error fetching defaulters:', err);
    res.status(500).json({ error: 'Failed to fetch defaulters' });
  }
};
