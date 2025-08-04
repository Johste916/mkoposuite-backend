// src/routes/repaymentRoutes.js

const express = require('express');
const router = express.Router();
const repaymentController = require('../controllers/repaymentController');
const { authenticateUser } = require('../middleware/authMiddleware');

// 📥 Get all repayments
router.get('/', authenticateUser, repaymentController.getAllRepayments);

// 📥 Get repayments for a specific borrower
router.get('/borrower/:borrowerId', authenticateUser, repaymentController.getRepaymentsByBorrower);

// 📤 Manually create a repayment (Admin only)
router.post('/', authenticateUser, repaymentController.createRepayment);

module.exports = router;
