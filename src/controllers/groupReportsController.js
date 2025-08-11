const { Op } = require('sequelize');
const models = require('../models');

const BorrowerGroup = models.BorrowerGroup || models.Group || null;
const GroupMember = models.BorrowerGroupMember || models.GroupMember || null;
const Loan = models.Loan || null;
const Borrower = models.Borrower || null;

const safeNum = (v) => Number(v || 0);

exports.getGroupSummary = async (req, res) => {
  try {
    let result = {
      totalGroups: 0,
      activeGroups: 0,
      totalLoans: 0,
      par: '0%'
    };

    // Total groups
    if (BorrowerGroup) {
      result.totalGroups = await BorrowerGroup.count();
    }

    // Active groups (groups with at least one active loan)
    if (BorrowerGroup && Loan) {
      const activeGroupIds = await Loan.findAll({
        attributes: ['groupId'],
        where: { status: 'active', groupId: { [Op.ne]: null } },
        group: ['groupId']
      });
      result.activeGroups = activeGroupIds.length;
    }

    // Total loan balances for groups
    if (Loan) {
      const loans = await Loan.findAll({ where: { groupId: { [Op.ne]: null } } });
      result.totalLoans = loans.reduce((sum, l) => sum + safeNum(l.amount), 0);
    }

    // Portfolio at Risk (PAR) for group loans
    if (Loan) {
      const overdueLoans = await Loan.findAll({
        where: {
          groupId: { [Op.ne]: null },
          status: 'active',
          dueDate: { [Op.lt]: new Date() },
          balance: { [Op.gt]: 0 }
        }
      });
      const overdueAmount = overdueLoans.reduce((sum, l) => sum + safeNum(l.balance), 0);

      const parValue = result.totalLoans > 0
        ? ((overdueAmount / result.totalLoans) * 100).toFixed(2)
        : 0;

      result.par = `${parValue}%`;
    }

    return res.json(result);
  } catch (error) {
    console.error('getGroupSummary error:', error);
    return res.json({
      totalGroups: 0,
      activeGroups: 0,
      totalLoans: 0,
      par: '0%'
    });
  }
};
