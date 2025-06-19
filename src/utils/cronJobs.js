// backend/src/utils/cronJobs.js
const cron = require('node-cron');
const path = require('path');
const ejs  = require('ejs');
const { Op } = require('sequelize');
const { LoanRepayment, Loan, User } = require('../../models');
const { sendMail } = require('./emailService');

function startCronJobs() {
  // 1) Every night at 00:00 UTC: mark overdue + send overdue notice
  cron.schedule('0 0 * * *', async () => {
    console.log('Cron: marking overdue and emailing notices…');
    try {
      const [count, updatedRows] = await LoanRepayment.update(
        { status: 'overdue' },
        {
          where: {
            dueDate: { [Op.lt]: new Date() },
            status: 'pending'
          },
          returning: true
        }
      );
      console.log(`Marked ${count} repayments as overdue.`);
      for (let repayment of updatedRows) {
        // fetch the loan and its borrower
        const loan = await Loan.findByPk(repayment.loanId, {
          include: [{ model: User, as: 'user' }]
        });
        if (!loan) continue;
        const borrower = loan.user;
        const html = await ejs.renderFile(
          path.join(__dirname, '../templates/overdueNotice.ejs'),
          {
            borrowerName: borrower.name,
            loanId:       loan.id,
            amount:       repayment.total,
            dueDate:      repayment.dueDate.toLocaleDateString()
          }
        );
        await sendMail(borrower.email, 'Overdue Repayment Notice', html);
      }
    } catch (err) {
      console.error('Cron (overdue) error:', err);
    }
  }, { timezone: 'UTC' });

  // 2) Every day at 08:00 UTC: send 24-hour reminders
  cron.schedule('0 8 * * *', async () => {
    console.log('Cron: sending repayment reminders for tomorrow…');
    try {
      const start = new Date();
      start.setDate(start.getDate() + 1);
      start.setHours(0,0,0,0);
      const end = new Date(start);
      end.setHours(23,59,59,999);

      const reminders = await LoanRepayment.findAll({
        where: {
          dueDate: { [Op.between]: [start, end] },
          status: 'pending'
        },
        include: [
          {
            model: Loan,
            as: 'loan',
            include: [{ model: User, as: 'user' }]
          }
        ]
      });

      console.log(`Found ${reminders.length} upcoming repayments.`);
      for (let repayment of reminders) {
        const loan     = repayment.loan;
        const borrower = loan.user;
        const html = await ejs.renderFile(
          path.join(__dirname, '../templates/repaymentReminder.ejs'),
          {
            borrowerName: borrower.name,
            loanId:       loan.id,
            amount:       repayment.total,
            dueDate:      repayment.dueDate.toLocaleDateString()
          }
        );
        await sendMail(borrower.email, 'Upcoming Repayment Reminder', html);
      }
    } catch (err) {
      console.error('Cron (reminder) error:', err);
    }
  }, { timezone: 'UTC' });

  console.log('⏰ Cron jobs scheduled: overnight overdue check @ 00:00 UTC, reminders @ 08:00 UTC');
}

module.exports = startCronJobs;
