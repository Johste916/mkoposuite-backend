const express = require('express');
const router = express.Router();
const settingController = require('../controllers/settingController');
const { authenticateUser } = require('../middleware/authMiddleware'); // ✅ FIXED

// Loan Categories
router.post('/loan-categories', authenticateUser, settingController.createLoanCategory);
router.get('/loan-categories', authenticateUser, settingController.getLoanCategories);
router.put('/loan-categories/:id', authenticateUser, settingController.updateLoanCategory);
router.delete('/loan-categories/:id', authenticateUser, settingController.deleteLoanCategory);

// Loan Settings
router.get('/loan-settings', authenticateUser, settingController.getLoanSettings);
router.put('/loan-settings', authenticateUser, settingController.updateLoanSettings);

// System Settings
router.get('/system-settings', authenticateUser, settingController.getSystemSettings);
router.put('/system-settings', authenticateUser, settingController.updateSystemSettings);

module.exports = router;
