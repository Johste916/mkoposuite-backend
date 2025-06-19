'use strict';

const db = require('../../models'); // loads LoanRepayment from Sequelize models
const { Op } = require('sequelize');

const markOverdueRepayments = async () => {
  const now = new Date();

  try {
    const [count] = await db.LoanRepayment.update(
      { status: 'overdue' },
      {
        where: {
          dueDate: { [Op.lt]: now },
          status: 'pending'
        }
      }
    );

    console.log(`Marked ${count} repayments as overdue.`);
  } catch (err) {
    console.error('Error marking overdue:', err.message);
  }
};

module.exports = markOverdueRepayments;
