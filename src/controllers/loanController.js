// controllers/loanController.js
const { Loan, Borrower, Branch, User } = require('../models');
const {
  generateFlatRateSchedule,
  generateReducingBalanceSchedule,
} = require('../utils/generateSchedule');

// Create Loan
const createLoan = async (req, res) => {
  try {
    const payload = {
      ...req.body,
      initiatedBy: req.user.id,
      status: 'pending',
    };
    const loan = await Loan.create(payload);
    res.status(201).json(loan);
  } catch (err) {
    console.error('Create loan error:', err);
    res.status(500).json({ error: 'Failed to create loan' });
  }
};

// Get All Loans
const getAllLoans = async (req, res) => {
  try {
    const loans = await Loan.findAll({
      include: [
        { model: Borrower },
        { model: Branch, as: 'branch' },
        { model: User, as: 'initiator', attributes: ['id', 'name'] },
        { model: User, as: 'approver', attributes: ['id', 'name'] },
        { model: User, as: 'rejector', attributes: ['id', 'name'] },
        { model: User, as: 'disburser', attributes: ['id', 'name'] },
      ],
      order: [['createdAt', 'DESC']],
    });
    res.json(loans);
  } catch (err) {
    console.error('Fetch loans error:', err);
    res.status(500).json({ error: 'Failed to fetch loans' });
  }
};

// Get Single Loan
const getLoanById = async (req, res) => {
  try {
    const loan = await Loan.findByPk(req.params.id, {
      include: [
        { model: Borrower },
        { model: Branch, as: 'branch' },
        { model: User, as: 'initiator', attributes: ['id', 'name'] },
        { model: User, as: 'approver', attributes: ['id', 'name'] },
        { model: User, as: 'rejector', attributes: ['id', 'name'] },
        { model: User, as: 'disburser', attributes: ['id', 'name'] },
      ],
    });
    if (!loan) return res.status(404).json({ error: 'Loan not found' });
    res.json(loan);
  } catch (err) {
    res.status(500).json({ error: 'Error fetching loan' });
  }
};

// Update Loan
const updateLoan = async (req, res) => {
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
const deleteLoan = async (req, res) => {
  try {
    const loan = await Loan.findByPk(req.params.id);
    if (!loan) return res.status(404).json({ error: 'Loan not found' });

    await loan.destroy();
    res.json({ message: 'Loan deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Error deleting loan' });
  }
};

// Approve Loan
const approveLoan = async (req, res) => {
  try {
    const loan = await Loan.findByPk(req.params.id);
    if (!loan || loan.status !== 'pending')
      return res.status(400).json({ error: 'Invalid loan or status' });

    await loan.update({
      status: 'approved',
      approvedBy: req.user.id,
      approvalDate: new Date(),
      approvalComments: req.body.approvalComments || '',
    });

    res.json({ message: 'Loan approved' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to approve loan' });
  }
};

// Reject Loan
const rejectLoan = async (req, res) => {
  try {
    const loan = await Loan.findByPk(req.params.id);
    if (!loan || loan.status !== 'pending')
      return res.status(400).json({ error: 'Invalid loan or status' });

    await loan.update({
      status: 'rejected',
      rejectedBy: req.user.id,
      rejectionDate: new Date(),
      rejectionComments: req.body.rejectionComments || '',
    });

    res.json({ message: 'Loan rejected' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to reject loan' });
  }
};

// Disburse Loan
const disburseLoan = async (req, res) => {
  try {
    const loan = await Loan.findByPk(req.params.id);
    if (!loan || loan.status !== 'approved')
      return res.status(400).json({ error: 'Loan not approved' });

    await loan.update({
      status: 'disbursed',
      disbursedBy: req.user.id,
      disbursementDate: new Date(),
      disbursementMethod: req.body.disbursementMethod || 'cash',
    });

    res.json({ message: 'Loan disbursed' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to disburse loan' });
  }
};

// Amortization Schedule
const getLoanSchedule = async (req, res) => {
  try {
    const loanId = req.params.loanId;
    const loan = await Loan.findByPk(loanId);
    if (!loan) {
      return res.status(404).json({ error: 'Loan not found' });
    }

    const duration = Math.ceil(
      (new Date(loan.endDate) - new Date(loan.startDate)) / (1000 * 60 * 60 * 24 * 30)
    );

    const input = {
      amount: loan.amount,
      interestRate: loan.interestRate,
      term: duration,
      issueDate: loan.startDate,
    };

    let schedule = [];

    if (loan.interestMethod === 'flat') {
      schedule = generateFlatRateSchedule(input);
    } else if (loan.interestMethod === 'reducing') {
      schedule = generateReducingBalanceSchedule(input);
    } else {
      return res.status(400).json({ error: 'Invalid interest method' });
    }

    return res.json({ loanId, interestMethod: loan.interestMethod, schedule });
  } catch (error) {
    console.error('Error generating loan schedule:', error);
    return res.status(500).json({ error: 'Server error' });
  }
};

// Disbursement List
const getDisbursementList = async (req, res) => {
  try {
    const loans = await Loan.findAll({
      where: {},
      include: [
        { model: Borrower },
        { model: Branch, as: 'branch' },
        { model: User, as: 'initiator', attributes: ['id', 'name'] },
      ],
      order: [['createdAt', 'DESC']],
    });

    res.json(loans);
  } catch (error) {
    console.error('Disbursement list error:', error);
    res.status(500).json({ error: 'Failed to fetch disbursements' });
  }
};

module.exports = {
  createLoan,
  getAllLoans,
  getLoanById,
  updateLoan,
  deleteLoan,
  approveLoan,
  rejectLoan,
  disburseLoan,
  getLoanSchedule,
  getDisbursementList,
};
