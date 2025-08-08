// controllers/loanDisbursementController.js
const { Loan, Borrower, Branch, User, sequelize } = require('../models');
const { Op } = require('sequelize');

/** Only set attributes that exist on the Loan model */
const pickExisting = (model, payload) => {
  const out = {};
  const attrs = model?.rawAttributes || {};
  for (const [k, v] of Object.entries(payload)) {
    if (attrs[k]) out[k] = v;
  }
  return out;
};

/* =======================================================
   GET /api/disbursements  (your route: getDisbursementRequests)
   -> pending or approved
======================================================= */
exports.getDisbursementRequests = async (_req, res) => {
  try {
    const loans = await Loan.findAll({
      where: { status: { [Op.in]: ['pending', 'approved'] } },
      include: [
        { model: Borrower, attributes: ['id', 'name', 'phone', 'email'] },
        { model: Branch, as: 'branch', attributes: ['id', 'name'] },
        { model: User, as: 'initiator', attributes: ['id', 'name'] },
        { model: User, as: 'approver', attributes: ['id', 'name'] },
      ],
      order: [['updatedAt', 'DESC']],
    });
    res.json(loans);
  } catch (err) {
    console.error('getDisbursementRequests error:', err);
    res.status(500).json({ message: 'Failed to fetch disbursement requests' });
  }
};

/* =======================================================
   POST /api/disbursements/initiate
   body: { loanId, note? }
   roles via middleware: Loan Officer, Admin
   -> mark loan as pending & record initiator
======================================================= */
exports.initiateDisbursement = async (req, res) => {
  try {
    const { loanId, note } = req.body;
    const loan = await Loan.findByPk(loanId);
    if (!loan) return res.status(404).json({ message: 'Loan not found' });

    // Only initiate from 'approved' or 'pending' (adjust if your flow differs)
    if (!['pending', 'approved'].includes(loan.status)) {
      return res.status(400).json({ message: 'Loan must be pending/approved to initiate' });
    }

    const payload = pickExisting(Loan, {
      status: 'pending',
      initiatedBy: req.user?.id,
      initiationNote: note || null,      // only applied if column exists
      initiationDate: new Date(),        // only applied if column exists
    });

    await loan.update(payload);
    res.status(200).json({ message: 'Disbursement initiated' });
  } catch (err) {
    console.error('initiateDisbursement error:', err);
    res.status(500).json({ message: 'Failed to initiate disbursement' });
  }
};

/* =======================================================
   POST /api/disbursements/approve
   body: { loanId, note? }
   roles: Manager, Director, Admin
   -> status -> approved
======================================================= */
exports.approveDisbursement = async (req, res) => {
  try {
    const { loanId, note } = req.body;
    const loan = await Loan.findByPk(loanId);
    if (!loan) return res.status(404).json({ message: 'Loan not found' });

    if (loan.status !== 'pending') {
      return res.status(400).json({ message: 'Loan must be pending to approve' });
    }

    const payload = pickExisting(Loan, {
      status: 'approved',
      approvedBy: req.user?.id,
      approvalDate: new Date(),
      approvalComments: note || loan.approvalComments || null,
    });

    await loan.update(payload);
    res.status(200).json({ message: 'Disbursement approved' });
  } catch (err) {
    console.error('approveDisbursement error:', err);
    res.status(500).json({ message: 'Failed to approve disbursement' });
  }
};

/* =======================================================
   POST /api/disbursements/finalize
   body: { loanId, amount?, method?, date? }
   roles: Accountant, Admin
   -> status -> disbursed
   Uses same fields as your loanController.disburseLoan.
======================================================= */
exports.finalizeDisbursement = async (req, res) => {
  try {
    const { loanId, amount, method = 'cash', date } = req.body;

    const loan = await Loan.findByPk(loanId);
    if (!loan) return res.status(404).json({ message: 'Loan not found' });

    if (loan.status !== 'approved') {
      return res.status(400).json({ message: 'Loan must be approved before disbursement' });
    }

    const payload = pickExisting(Loan, {
      status: 'disbursed',
      disbursementDate: date ? new Date(date) : new Date(),
      disbursementMethod: method,
      disbursedBy: req.user?.id,
      // Support either column name if present in your schema:
      disbursedAmount: amount || loan.amount,
      amountDisbursed: amount || loan.amount,
    });

    await loan.update(payload);
    res.status(200).json({ message: 'Loan disbursed successfully' });
  } catch (err) {
    console.error('finalizeDisbursement error:', err);
    res.status(500).json({ message: 'Failed to finalize disbursement' });
  }
};

/* =======================================================
   POST /api/disbursements/reject
   body: { loanId, reason? }
   roles: Manager, Director, Admin
   -> status -> rejected
======================================================= */
exports.rejectDisbursement = async (req, res) => {
  try {
    const { loanId, reason } = req.body;
    const loan = await Loan.findByPk(loanId);
    if (!loan) return res.status(404).json({ message: 'Loan not found' });

    if (!['pending', 'approved'].includes(loan.status)) {
      return res.status(400).json({ message: 'Only pending/approved loans can be rejected' });
    }

    const payload = pickExisting(Loan, {
      status: 'rejected',
      rejectionDate: new Date(),
      rejectedBy: req.user?.id,
      rejectionComments: reason || 'Rejected',
    });

    await loan.update(payload);
    res.status(200).json({ message: 'Disbursement rejected' });
  } catch (err) {
    console.error('rejectDisbursement error:', err);
    res.status(500).json({ message: 'Failed to reject disbursement' });
  }
};
