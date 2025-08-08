// src/controllers/loanController.js
const { Loan, Borrower, Branch, User } = require('../models');
const { generateFlatRateSchedule, generateReducingBalanceSchedule } = require('../utils/generateSchedule');

const BORROWER_ATTRS = ['id', 'name', 'nationalId', 'phone']; // <-- no "fullName"

const createLoan = async (req, res) => {
  try {
    const loan = await Loan.create({
      ...req.body,
      initiatedBy: req.user?.id || null,
      status: 'pending',
    });
    res.status(201).json(loan);
  } catch (err) {
    console.error('Create loan error:', err);
    res.status(500).json({ error: 'Failed to create loan' });
  }
};

const getAllLoans = async (req, res) => {
  try {
    const loans = await Loan.findAll({
      include: [
        { model: Borrower, attributes: BORROWER_ATTRS },
        { model: Branch, as: 'branch' }, // ensure your assoc uses `as: 'branch'`
        { model: User, as: 'initiator', attributes: ['id', 'name'] },
        { model: User, as: 'approver', attributes: ['id', 'name'] },
        { model: User, as: 'rejector', attributes: ['id', 'name'] },
        { model: User, as: 'disburser', attributes: ['id', 'name'] },
      ],
      order: [['createdAt', 'DESC']],
      limit: 500, // keep it sane
    });
    res.json(loans || []);
  } catch (err) {
    console.error('Fetch loans error:', err);
    res.status(500).json({ error: 'Failed to fetch loans' });
  }
};

const getLoanById = async (req, res) => {
  try {
    const loan = await Loan.findByPk(req.params.id, {
      include: [
        { model: Borrower, attributes: BORROWER_ATTRS },
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
    console.error('Get loan by id error:', err);
    res.status(500).json({ error: 'Error fetching loan' });
  }
};

const updateLoan = async (req, res) => {
  try {
    const loan = await Loan.findByPk(req.params.id);
    if (!loan) return res.status(404).json({ error: 'Loan not found' });

    await loan.update(req.body);
    res.json(loan);
  } catch (err) {
    console.error('Update loan error:', err);
    res.status(500).json({ error: 'Error updating loan' });
  }
};

const deleteLoan = async (req, res) => {
  try {
    const loan = await Loan.findByPk(req.params.id);
    if (!loan) return res.status(404).json({ error: 'Loan not found' });

    await loan.destroy();
    res.json({ message: 'Loan deleted' });
  } catch (err) {
    console.error('Delete loan error:', err);
    res.status(500).json({ error: 'Error deleting loan' });
  }
};

const approveLoan = async (req, res) => {
  try {
    const loan = await Loan.findByPk(req.params.id);
    if (!loan || loan.status !== 'pending')
      return res.status(400).json({ error: 'Invalid loan or status' });

    await loan.update({
      status: 'approved',
      approvedBy: req.user?.id || null,
      approvalDate: new Date(),
      approvalComments: req.body.approvalComments || '',
    });

    res.json({ message: 'Loan approved' });
  } catch (err) {
    console.error('Approve loan error:', err);
    res.status(500).json({ error: 'Failed to approve loan' });
  }
};

const rejectLoan = async (req, res) => {
  try {
    const loan = await Loan.findByPk(req.params.id);
    if (!loan || loan.status !== 'pending')
      return res.status(400).json({ error: 'Invalid loan or status' });

    await loan.update({
      status: 'rejected',
      rejectedBy: req.user?.id || null,
      rejectionDate: new Date(),
      rejectionComments: req.body.rejectionComments || '',
    });

    res.json({ message: 'Loan rejected' });
  } catch (err) {
    console.error('Reject loan error:', err);
    res.status(500).json({ error: 'Failed to reject loan' });
  }
};

const disburseLoan = async (req, res) => {
  try {
    const loan = await Loan.findByPk(req.params.id);
    if (!loan || loan.status !== 'approved')
      return res.status(400).json({ error: 'Loan not approved' });

    await loan.update({
      status: 'disbursed',
      disbursedBy: req.user?.id || null,
      disbursementDate: new Date(),
      disbursementMethod: req.body.disbursementMethod || 'cash',
    });

    res.json({ message: 'Loan disbursed' });
  } catch (err) {
    console.error('Disburse loan error:', err);
    res.status(500).json({ error: 'Failed to disburse loan' });
  }
};

const getLoanSchedule = async (req, res) => {
  try {
    const loan = await Loan.findByPk(req.params.loanId);
    if (!loan) return res.status(404).json({ error: 'Loan not found' });

    const msPerMonth = 1000 * 60 * 60 * 24 * 30;
    const duration = Math.max(1, Math.ceil((new Date(loan.endDate) - new Date(loan.startDate)) / msPerMonth));

    const input = {
      amount: Number(loan.amount || 0),
      interestRate: Number(loan.interestRate || 0),
      term: duration,
      issueDate: loan.startDate,
    };

    const schedule =
      loan.interestMethod === 'flat'
        ? generateFlatRateSchedule(input)
        : loan.interestMethod === 'reducing'
        ? generateReducingBalanceSchedule(input)
        : [];

    if (!schedule.length)
      return res.status(400).json({ error: 'Invalid interest method' });

    res.json({ loanId: loan.id, interestMethod: loan.interestMethod, schedule });
  } catch (err) {
    console.error('Get schedule error:', err);
    res.status(500).json({ error: 'Failed to generate schedule' });
  }
};

const getDisbursementList = async (_req, res) => {
  try {
    const loans = await Loan.findAll({
      where: { status: 'disbursed' },
      include: [
        { model: Borrower, attributes: BORROWER_ATTRS },
        { model: Branch, as: 'branch' },
        { model: User, as: 'initiator', attributes: ['id', 'name'] },
      ],
      order: [['disbursementDate', 'DESC']],
      limit: 500,
    });
    res.json(loans || []);
  } catch (err) {
    console.error('Disbursement list error:', err);
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
