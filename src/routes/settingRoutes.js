// routes/settingRoutes.js

const express = require('express');
const router = express.Router();
const { authenticateUser } = require('../middleware/authMiddleware');
// If you have role-based guard, uncomment and use it on the comms routes
// const { authorizeRole } = require('../middleware/authorizeRole');

// ==============================
// 📦 Controllers
// ==============================
const loanCategoriesController = require('../controllers/settings/loanCategoriesController');
const loanSettingsController = require('../controllers/settings/loanSettingsController');
const systemSettingsController = require('../controllers/settings/systemSettingsController');
const penaltySettingsController = require('../controllers/settings/penaltySettingsController');
const integrationSettingsController = require('../controllers/settings/integrationSettingsController');
const branchSettingsController = require('../controllers/settings/branchSettingsController');
const borrowerSettingsController = require('../controllers/settings/borrowerSettingsController');
const userManagementController = require('../controllers/settings/userManagementController');
const bulkSmsSettingsController = require('../controllers/settings/bulkSmsSettingsController');
const savingAccountSettingsController = require('../controllers/settings/savingAccountSettingsController');
const payrollSettingsController = require('../controllers/settings/payrollSettingsController');
const paymentSettingsController = require('../controllers/settings/paymentSettingsController');
const commentSettingsController = require('../controllers/settings/commentSettingsController');
const dashboardSettingsController = require('../controllers/settings/dashboardSettingsController');
const loanSectorSettingsController = require('../controllers/settings/loanSectorSettingsController');
const incomeSourceSettingsController = require('../controllers/settings/incomeSourceSettingsController');
const holidaySettingsController = require('../controllers/settings/holidaySettingsController');

// ✅ NEW: Communications settings controller
const communicationSettingsController = require('../controllers/settings/communicationSettingsController');

// ==============================
// 📁 Loan Categories
// ==============================
router.route('/loan-categories')
  .get(authenticateUser, loanCategoriesController.getLoanCategories)
  .post(authenticateUser, loanCategoriesController.createLoanCategory);

router.route('/loan-categories/:id')
  .put(authenticateUser, loanCategoriesController.updateLoanCategory)
  .delete(authenticateUser, loanCategoriesController.deleteLoanCategory);

// ==============================
// 📁 Loan Settings
// ==============================
router.route('/loan-settings')
  .get(authenticateUser, loanSettingsController.getLoanSettings)
  .put(authenticateUser, loanSettingsController.updateLoanSettings);

// ==============================
// 📁 System Settings
// ==============================
router.route('/system-settings')
  .get(authenticateUser, systemSettingsController.getSystemSettings)
  .put(authenticateUser, systemSettingsController.updateSystemSettings);

// ==============================
// 📁 Penalty Settings
// ==============================
router.route('/penalty-settings')
  .get(authenticateUser, penaltySettingsController.getPenaltySettings)
  .put(authenticateUser, penaltySettingsController.updatePenaltySettings);

// ==============================
// 📁 Integration Settings
// ==============================
router.route('/integration-settings')
  .get(authenticateUser, integrationSettingsController.getIntegrationSettings)
  .put(authenticateUser, integrationSettingsController.updateIntegrationSettings);

// ==============================
// 📁 Branch Settings
// ==============================
router.route('/branch-settings')
  .get(authenticateUser, branchSettingsController.getBranchSettings)
  .put(authenticateUser, branchSettingsController.updateBranchSettings);

// ==============================
// 📁 Borrower Settings
// ==============================
router.route('/borrower-settings')
  .get(authenticateUser, borrowerSettingsController.getBorrowerSettings)
  .put(authenticateUser, borrowerSettingsController.updateBorrowerSettings);

// ==============================
// 📁 User Management
// ==============================
router.route('/user-management')
  .get(authenticateUser, userManagementController.getUsers);

router.put('/user-management/:id', authenticateUser, userManagementController.updateUser);

// ==============================
// 📁 Bulk SMS Settings ✅
// ==============================
router.route('/bulk-sms-settings')
  .get(authenticateUser, bulkSmsSettingsController.getBulkSmsSettings)
  .put(authenticateUser, bulkSmsSettingsController.updateBulkSmsSettings);

// ==============================
// 📁 Saving Account Settings
// ==============================
router.route('/saving-settings')
  .get(authenticateUser, savingAccountSettingsController.getSavingAccountSettings)
  .put(authenticateUser, savingAccountSettingsController.updateSavingAccountSettings);

// ==============================
// 📁 Payroll Settings
// ==============================
router.route('/payroll-settings')
  .get(authenticateUser, payrollSettingsController.getPayrollSettings)
  .put(authenticateUser, payrollSettingsController.updatePayrollSettings);

// ==============================
// 📁 Payment Settings
// ==============================
router.route('/payment-settings')
  .get(authenticateUser, paymentSettingsController.getPaymentSettings)
  .put(authenticateUser, paymentSettingsController.updatePaymentSettings);

// ==============================
// 📁 Comment Settings
// ==============================
router.route('/comment-settings')
  .get(authenticateUser, commentSettingsController.getCommentSettings)
  .put(authenticateUser, commentSettingsController.updateCommentSettings);

// ==============================
// 📁 Dashboard Settings
// ==============================
router.route('/dashboard-settings')
  .get(authenticateUser, dashboardSettingsController.getDashboardSettings)
  .put(authenticateUser, dashboardSettingsController.updateDashboardSettings);

// ==============================
// 📁 Loan Sector Settings
// ==============================
router.route('/loan-sector-settings')
  .get(authenticateUser, loanSectorSettingsController.getLoanSectorSettings)
  .put(authenticateUser, loanSectorSettingsController.updateLoanSectorSettings);

// ==============================
// 📁 Income Source Settings
// ==============================
router.route('/income-source-settings')
  .get(authenticateUser, incomeSourceSettingsController.getIncomeSourceSettings)
  .put(authenticateUser, incomeSourceSettingsController.updateIncomeSourceSettings);

// ==============================
// 📁 Holiday Settings
// ==============================
router.route('/holiday-settings')
  .get(authenticateUser, holidaySettingsController.getHolidaySettings)
  .put(authenticateUser, holidaySettingsController.updateHolidaySettings);

// ==============================
// 📢 Communications Settings (NEW)
// Multiple records + attachments; prefer admin-only roles.
// ==============================
// If you have role-based auth, use: [authenticateUser, authorizeRole(['admin','superadmin'])]
router.route('/communications')
  .get(authenticateUser, communicationSettingsController.listCommunications)
  .post(authenticateUser, communicationSettingsController.createCommunication);

router.route('/communications/:id')
  .get(authenticateUser, communicationSettingsController.getCommunication)
  .put(authenticateUser, communicationSettingsController.updateCommunication)
  .delete(authenticateUser, communicationSettingsController.deleteCommunication);

router.post('/communications/:id/attachments',
  authenticateUser,
  communicationSettingsController.addAttachment
);

router.delete('/communications/:id/attachments/:attId',
  authenticateUser,
  communicationSettingsController.removeAttachment
);

// ==============================
// ✅ Export
// ==============================
module.exports = router;
