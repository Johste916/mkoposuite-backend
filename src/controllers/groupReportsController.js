// src/controllers/groupReportsController.js
const { Op } = require('sequelize');
const models = require('../models');

const Group = models.BorrowerGroup || models.Group || null;
const GroupMember = models.BorrowerGroupMember || models.GroupMember || null;
const Loan = models.Loan || null;
const Borrower = models.Borrower || null;

const safeNum = (v) => Number(v || 0);

exports.getGroupSummary = async (req, res) => {
  try {
    if (!Group) return res.status(501).json({ error: 'Group model not available' });

    // Total groups
    const totalGroups = await Group.count();

    // Active groups (groups that have at least one member or active loan)
    let activeGroups = 0;
    if (GroupMember) {
      const activeGroupIds = await GroupMember.findAll({
        attributes: ['groupId'],
        group: ['groupId'],
      });
      activeGroups = activeGroupIds.length;
    }

    // Total loans issued to groups
    let totalLoans = 0;
    if (Loan && Borrower && GroupMember) {
      const groupMemberBorrowerIds = await GroupMember.findAll({
        attributes: ['borrowerId'],
      });

      const borrowerIds = groupMemberBorrowerIds.map((m) => m.borrowerId);
      if (borrowerIds.length > 0) {
        const loans = await Loan.findAll({
          where: { borrowerId: { [Op.in]: borrowerIds } },
          attributes: ['amount'],
        });
        totalLoans = loans.reduce((acc, loan) => acc + safeNum(loan.amount), 0);
      }
    }

    // PAR (Portfolio at Risk) — simplistic version
    let par = '0%';
    if (Loan) {
      const overdueLoans = await Loan.count({
        where: { status: 'overdue' },
      });
      const totalLoanCount = await Loan.count();
      par = totalLoanCount > 0 ? `${((overdueLoans / totalLoanCount) * 100).toFixed(2)}%` : '0%';
    }

    return res.json({
      totalGroups,
      activeGroups,
      totalLoans,
      par,
    });
  } catch (error) {
    console.error('getGroupSummary error:', error);
    res.status(500).json({ error: 'Failed to load group report data' });
  }
};
