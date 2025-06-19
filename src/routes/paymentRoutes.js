const express = require('express');
const router = express.Router();
const verifyToken = require('../middleware/authMiddleware');
const { createPayment, getAllPayments } = require('../controllers/loanPaymentController');

// Get all payments
router.get('/', verifyToken, getAllPayments);

// Record a new loan payment
router.post('/', verifyToken, createPayment);

module.exports = router;
