// controllers/loanDisbursementController.js
const { Loan, User } = require('../models');

exports.initiateDisbursement = async (req, res) => {
  try {
    const { loanId } = req.body;
    const userId = req.user.id;

    const loan = await Loan.findByPk(loanId);
    if (!loan) return res.status(404).json({ message: 'Loan not found' });

    if (loan.status !== 'approved') {
      return res.status(400).json({ message: 'Loan must be approved first' });
    }

    loan.disbursementStatus = 'pending';
    loan.initiatedBy = userId;
    await loan.save();

    res.status(200).json({ message: 'Disbursement initiated' });
  } catch (err) {
    console.error('Initiate error:', err);
    res.status(500).json({ message: 'Failed to initiate disbursement' });
  }
};

exports.approveDisbursement = async (req, res) => {
  try {
    const { loanId } = req.body;
    const userId = req.user.id;

    const loan = await Loan.findByPk(loanId);
    if (!loan || loan.disbursementStatus !== 'pending') {
      return res.status(400).json({ message: 'Invalid loan or status' });
    }

    loan.disbursementStatus = 'approved';
    loan.approvedBy = userId;
    await loan.save();

    res.status(200).json({ message: 'Disbursement approved' });
  } catch (err) {
    console.error('Approve error:', err);
    res.status(500).json({ message: 'Failed to approve disbursement' });
  }
};

exports.finalizeDisbursement = async (req, res) => {
  try {
    const { loanId, disbursedAmount, date } = req.body;
    const userId = req.user.id;

    const loan = await Loan.findByPk(loanId);
    if (!loan || loan.disbursementStatus !== 'approved') {
      return res.status(400).json({ message: 'Loan not ready for disbursement' });
    }

    loan.disbursementStatus = 'disbursed';
    loan.disbursedAmount = disbursedAmount;
    loan.disbursedDate = date || new Date();
    loan.disbursedBy = userId;
    loan.status = 'disbursed';
    await loan.save();

    res.status(200).json({ message: 'Loan disbursed successfully' });
  } catch (err) {
    console.error('Finalize error:', err);
    res.status(500).json({ message: 'Failed to finalize disbursement' });
  }
};

exports.rejectDisbursement = async (req, res) => {
  try {
    const { loanId, reason } = req.body;
    const loan = await Loan.findByPk(loanId);
    if (!loan || loan.disbursementStatus !== 'pending') {
      return res.status(400).json({ message: 'Loan not pending disbursement' });
    }

    loan.disbursementStatus = 'rejected';
    loan.disbursementNote = reason || 'Rejected by manager';
    await loan.save();

    res.status(200).json({ message: 'Disbursement rejected' });
  } catch (err) {
    console.error('Reject error:', err);
    res.status(500).json({ message: 'Failed to reject disbursement' });
  }
};

exports.getDisbursementRequests = async (req, res) => {
  try {
    const loans = await Loan.findAll({
      where: {
        disbursementStatus: ['pending', 'approved']
      },
      include: [{ model: User, as: 'borrower' }]
    });

    res.json(loans);
  } catch (err) {
    console.error('Fetch error:', err);
    res.status(500).json({ message: 'Failed to fetch disbursement requests' });
  }
};
