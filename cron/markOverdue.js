const cron = require('node-cron');
const { LoanRepayment } = require('../models');

const markOverdueRepayments = async () => {
  try {
    const [count] = await LoanRepayment.update(
      { status: 'overdue' },
      {
        where: {
          dueDate: { [require('sequelize').Op.lt]: new Date() },
          status: 'pending'
        }
      }
    );
    console.log(`Marked ${count} repayments as overdue.`);
  } catch (error) {
    console.error('Error marking overdue:', error.message);
  }
};

const startOverdueCron = () => {
  cron.schedule('0 0 * * *', markOverdueRepayments); // Runs at midnight
  console.log('⏰ Cron job started to mark overdue repayments daily at midnight');
  markOverdueRepayments(); // Run once at server start
};

module.exports = startOverdueCron;
