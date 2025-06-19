// backend/src/controllers/loanRepaymentController.js

const { LoanRepayment, Loan } = require('../models');

exports.getRepaymentsByLoan = async (req, res) => {
  try {
    const repayments = await LoanRepayment.findAll({
      where: { loanId: req.params.loanId },
      order: [['dueDate', 'ASC']]
    });
    res.status(200).json(repayments);
  } catch (err) {
    console.error('Error fetching repayments:', err);
    res.status(500).json({ error: 'Failed to fetch repayments' });
  }
};

exports.markAsPaid = async (req, res) => {
  try {
    const repayment = await LoanRepayment.findByPk(req.params.id);
    if (!repayment) return res.status(404).json({ error: 'Repayment not found' });

    await repayment.update({
      status: 'paid',
      paidDate: new Date(),
      amountPaid: repayment.amount
    });

    res.json(repayment);
  } catch (err) {
    console.error('Error marking repayment as paid:', err);
    res.status(500).json({ error: 'Failed to update repayment' });
  }
};

exports.flagOverdueRepayments = async (req, res) => {
  try {
    const today = new Date();
    const updated = await LoanRepayment.update(
      { status: 'overdue' },
      {
        where: {
          status: 'pending',
          dueDate: { [require('sequelize').Op.lt]: today }
        }
      }
    );
    res.json({ message: 'Overdue repayments flagged', count: updated[0] });
  } catch (err) {
    console.error('Error flagging overdue repayments:', err);
    res.status(500).json({ error: 'Failed to update repayments' });
  }
};
