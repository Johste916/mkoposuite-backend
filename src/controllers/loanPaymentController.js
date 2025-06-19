// backend/src/controllers/loanPaymentController.js

const { LoanPayment, Loan } = require('../models');

exports.getAllPayments = async (req, res) => {
  try {
    const payments = await LoanPayment.findAll({
      include: [{ model: Loan }]
    });
    res.json(payments);
  } catch (err) {
    console.error('Error fetching payments:', err);
    res.status(500).json({ error: 'Failed to fetch payments' });
  }
};

exports.createPayment = async (req, res) => {
  try {
    const newPayment = await LoanPayment.create(req.body);
    res.status(201).json(newPayment);
  } catch (err) {
    console.error('Error creating payment:', err);
    res.status(400).json({ error: 'Failed to create payment' });
  }
};
