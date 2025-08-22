// backend/src/routes/settingRoutes.js
'use strict';

const express = require('express');
const router = express.Router();
const { authenticateUser } = require('../middleware/authMiddleware');

/* ==============================
   Controllers (existing)
   ============================== */
const loanCategoriesController = require('../controllers/settings/loanCategoriesController');
const loanSettingsController = require('../controllers/settings/loanSettingsController');
const systemSettingsController = require('../controllers/settings/systemSettingsController');
const penaltySettingsController = require('../controllers/settings/penaltySettingsController');
const integrationSettingsOldController = require('../controllers/settings/integrationSettingsController');
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
const communicationSettingsController = require('../controllers/settings/communicationSettingsController');

/* ==============================
   NEW controllers (Batch 1)
   ============================== */
const generalSettingsController = require('../controllers/settings/generalSettingsController');
const apiSettingsController = require('../controllers/settings/apiSettingsController');
const smsSettingsController = require('../controllers/settings/smsSettingsController');
const emailSettingsController = require('../controllers/settings/emailSettingsController');
const loanFeesController = require('../controllers/settings/loanFeesController');
const loanRemindersController = require('../controllers/settings/loanRemindersController');

/* ==============================
   NEW controllers (Loans batch 2)
   ============================== */
const loanCyclesController = require('../controllers/settings/loanCyclesController');
const loanTemplatesController = require('../controllers/settings/loanTemplatesController');
const loanApprovalsController = require('../controllers/settings/loanApprovalsController');

/* ==============================
   Sidebar config (FIX for 404)
   ============================== */
/**
 * Returns the menu items and feature flags used by the frontend to render the sidebar.
 * If you want this accessible pre-login, remove `authenticateUser`.
 */
router.get('/sidebar', authenticateUser, (req, res) => {
  res.json({
    items: [
      { path: '/',                    label: 'Dashboard',           icon: 'home' },
      { path: '/borrowers',           label: 'Borrowers',           icon: 'users' },
      { path: '/loans',               label: 'Loans',               icon: 'credit-card' },
      { path: '/repayments',          label: 'Repayments',          icon: 'receipt' },
      { path: '/collections',         label: 'Collection Sheets',   icon: 'calendar' },
      { path: '/savings-transactions',label: 'Savings Txns',        icon: 'wallet' },
      { path: '/investors',           label: 'Investors',           icon: 'briefcase' },
      { path: '/assets',              label: 'Assets',              icon: 'package' },
      { path: '/reports',             label: 'Reports',             icon: 'bar-chart-2' },
      { path: '/settings',            label: 'Settings',            icon: 'settings' },
    ],
    featureFlags: {
      collections: true,
      savingsTransactions: true,
      investors: true,
      collateral: true,
      payroll: true,
      expenses: true,
      otherIncome: true,
      accounting: true,
      esignatures: true,
    },
  });
});

/* ==============================
   Loan Categories
   ============================== */
router.route('/loan-categories')
  .get(authenticateUser, loanCategoriesController.getLoanCategories)
  .post(authenticateUser, loanCategoriesController.createLoanCategory);

router.route('/loan-categories/:id')
  .put(authenticateUser, loanCategoriesController.updateLoanCategory)
  .delete(authenticateUser, loanCategoriesController.deleteLoanCategory);

/* ==============================
   Loan Settings
   ============================== */
router.route('/loan-settings')
  .get(authenticateUser, loanSettingsController.getLoanSettings)
  .put(authenticateUser, loanSettingsController.updateLoanSettings);

/* ==============================
   System Settings
   ============================== */
router.route('/system-settings')
  .get(authenticateUser, systemSettingsController.getSystemSettings)
  .put(authenticateUser, systemSettingsController.updateSystemSettings);

/* ==============================
   Penalty Settings
   ============================== */
router.route('/penalty-settings')
  .get(authenticateUser, penaltySettingsController.getPenaltySettings)
  .put(authenticateUser, penaltySettingsController.updatePenaltySettings);

/* ==============================
   Integration Settings (legacy)
   ============================== */
router.route('/integration-settings')
  .get(authenticateUser, integrationSettingsOldController.getIntegrationSettings)
  .put(authenticateUser, integrationSettingsOldController.updateIntegrationSettings);

/* ==============================
   Branch Settings
   ============================== */
router.route('/branch-settings')
  .get(authenticateUser, branchSettingsController.getBranchSettings);
router.put('/branch-settings/:id',
  authenticateUser,
  branchSettingsController.updateBranchSettings
);

/* ==============================
   Borrower Settings
   ============================== */
router.route('/borrower-settings')
  .get(authenticateUser, borrowerSettingsController.getBorrowerSettings)
  .put(authenticateUser, borrowerSettingsController.updateBorrowerSettings);

/* ==============================
   User Management Settings
   ============================== */
router.route('/user-management')
  .get(authenticateUser, userManagementController.getUsers)
  .put(authenticateUser, userManagementController.updateUser);

/* ==============================
   Bulk SMS (basic gateway config)
   ============================== */
router.route('/bulk-sms-settings')
  .get(authenticateUser, bulkSmsSettingsController.getBulkSmsSettings)
  .put(authenticateUser, bulkSmsSettingsController.updateBulkSmsSettings);

/* ==============================
   Saving Account Settings
   ============================== */
router.route('/saving-settings')
  .get(authenticateUser, savingAccountSettingsController.getSavingAccountSettings)
  .put(authenticateUser, savingAccountSettingsController.updateSavingAccountSettings);

/* ==============================
   Payroll Settings
   ============================== */
router.route('/payroll-settings')
  .get(authenticateUser, payrollSettingsController.getPayrollSettings)
  .put(authenticateUser, payrollSettingsController.updatePayrollSettings);

/* ==============================
   Payment Settings
   ============================== */
router.route('/payment-settings')
  .get(authenticateUser, paymentSettingsController.getPaymentSettings)
  .put(authenticateUser, paymentSettingsController.updatePaymentSettings);

/* ==============================
   Comment Settings
   ============================== */
router.route('/comment-settings')
  .get(authenticateUser, commentSettingsController.getCommentSettings)
  .put(authenticateUser, commentSettingsController.updateCommentSettings);

/* ==============================
   Dashboard Settings
   ============================== */
router.route('/dashboard-settings')
  .get(authenticateUser, dashboardSettingsController.getDashboardSettings)
  .put(authenticateUser, dashboardSettingsController.updateDashboardSettings);

/* ==============================
   Loan Sector Settings
   ============================== */
router.route('/loan-sector-settings')
  .get(authenticateUser, loanSectorSettingsController.getLoanSectorSettings)
  .put(authenticateUser, loanSectorSettingsController.updateLoanSectorSettings);

/* ==============================
   Income Source Settings
   ============================== */
router.route('/income-source-settings')
  .get(authenticateUser, incomeSourceSettingsController.getIncomeSourceSettings)
  .put(authenticateUser, incomeSourceSettingsController.updateIncomeSourceSettings);

/* ==============================
   Holiday Settings
   ============================== */
router.route('/holiday-settings')
  .get(authenticateUser, holidaySettingsController.getHolidaySettings)
  .put(authenticateUser, holidaySettingsController.updateHolidaySettings);

/* ==============================
   Communications (announcements)
   ============================== */
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

/* ==============================
   NEW — General
   ============================== */
router.route('/general')
  .get(authenticateUser, generalSettingsController.getGeneral)
  .put(authenticateUser, generalSettingsController.updateGeneral);

/* ==============================
   NEW — API (kept for parity)
   ============================== */
router.route('/api')
  .get(authenticateUser, apiSettingsController.getApiSettings)
  .put(authenticateUser, apiSettingsController.updateApiSettings);

/* ==============================
   NEW — SMS / Email
   ============================== */
router.route('/sms')
  .get(authenticateUser, smsSettingsController.getSmsSettings)
  .put(authenticateUser, smsSettingsController.updateSmsSettings);

router.route('/email')
  .get(authenticateUser, emailSettingsController.getEmailSettings)
  .put(authenticateUser, emailSettingsController.updateEmailSettings);

/* ==============================
   NEW — Loan Fees / Reminders / Cycles / Templates / Approvals
   ============================== */
router.route('/loan-fees')
  .get(authenticateUser, loanFeesController.getLoanFees)
  .put(authenticateUser, loanFeesController.updateLoanFees);

router.route('/loan-reminders')
  .get(authenticateUser, loanRemindersController.getLoanReminders)
  .put(authenticateUser, loanRemindersController.updateLoanReminders);

router.route('/loan-repayment-cycles')
  .get(authenticateUser, loanCyclesController.getLoanCycles)
  .put(authenticateUser, loanCyclesController.updateLoanCycles);

router.route('/loan-templates')
  .get(authenticateUser, loanTemplatesController.getLoanTemplates)
  .put(authenticateUser, loanTemplatesController.updateLoanTemplates);

router.route('/loan-approvals')
  .get(authenticateUser, loanApprovalsController.getLoanApprovals)
  .put(authenticateUser, loanApprovalsController.updateLoanApprovals);

/* ==============================
   Export
   ============================== */
module.exports = router;
