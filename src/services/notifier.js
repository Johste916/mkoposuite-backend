// src/services/notifier.js
// Simple notifier stub. Uses Communication model if present;
// otherwise logs. Wire to SMS/Email gateway via environment variables.

module.exports = ({ Communication, Borrower }) => {
  const sendSMS = async ({ to, message }) => {
    // TODO: integrate e.g. Twilio/Africa's Talking using env keys
    // For now, just log and persist if Communication exists
    console.log('[SMS]', to, message);
    if (Communication) {
      try {
        await Communication.create({
          channel: 'sms',
          to,
          body: message,
          status: 'queued',
        });
      } catch (e) {
        console.warn('Communication save failed:', e.message);
      }
    }
  };

  const sendEmail = async ({ to, subject, html }) => {
    console.log('[Email]', to, subject);
    if (Communication) {
      try {
        await Communication.create({
          channel: 'email',
          to,
          subject,
          body: html,
          status: 'queued',
        });
      } catch (e) {
        console.warn('Communication save failed:', e.message);
      }
    }
  };

  const notifyBorrowerRepayment = async ({ borrower, amount, loanRef, method }) => {
    const name = borrower?.name || 'Customer';
    const phone = borrower?.phone || '';
    const email = borrower?.email || '';
    const msg = `Hi ${name}, your repayment of ${amount} for Loan ${loanRef} has been received via ${method}. Thank you.`;

    if (phone) await sendSMS({ to: phone, message: msg });
    if (email) await sendEmail({ to: email, subject: 'Repayment received', html: msg });
  };

  return { sendSMS, sendEmail, notifyBorrowerRepayment };
};
