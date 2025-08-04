// routes/settingRoutes.js
const express = require('express');
const router = express.Router();
const settingController = require('../controllers/settingController');
const { authenticateToken } = require('../middleware/authMiddleware');

// Loan Categories
router.post('/loan-categories', authenticateToken, settingController.createLoanCategory);
router.get('/loan-categories', authenticateToken, settingController.getLoanCategories);
router.put('/loan-categories/:id', authenticateToken, settingController.updateLoanCategory);
router.delete('/loan-categories/:id', authenticateToken, settingController.deleteLoanCategory);

// Loan Settings
router.get('/loan-settings', authenticateToken, settingController.getLoanSettings);
router.put('/loan-settings', authenticateToken, settingController.updateLoanSettings);

// System Settings
router.get('/system-settings', authenticateToken, settingController.getSystemSettings);
router.put('/system-settings', authenticateToken, settingController.updateSystemSettings);

module.exports = router;
