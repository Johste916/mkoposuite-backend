'use strict';

const express = require('express');
const router = express.Router();

const { authenticateUser, requireAuth, authorizeRoles } = require('../middleware/authMiddleware');

/* =============================================================================
   Controllers (existing)
============================================================================= */
const loanCategoriesController        = require('../controllers/settings/loanCategoriesController');
const loanSettingsController          = require('../controllers/settings/loanSettingsController');
const systemSettingsController        = require('../controllers/settings/systemSettingsController');
const penaltySettingsController       = require('../controllers/settings/penaltySettingsController');
const integrationSettingsController   = require('../controllers/settings/integrationSettingsController');
const branchSettingsController        = require('../controllers/settings/branchSettingsController');
const borrowerSettingsController      = require('../controllers/settings/borrowerSettingsController');
const userManagementController        = require('../controllers/settings/userManagementController');
const bulkSmsSettingsController       = require('../controllers/settings/bulkSmsSettingsController');
const savingAccountSettingsController = require('../controllers/settings/savingAccountSettingsController');
const payrollSettingsController       = require('../controllers/settings/payrollSettingsController');
const paymentSettingsController       = require('../controllers/settings/paymentSettingsController');
const commentSettingsController       = require('../controllers/settings/commentSettingsController');
const dashboardSettingsController     = require('../controllers/settings/dashboardSettingsController');
const loanSectorSettingsController    = require('../controllers/settings/loanSectorSettingsController');
const incomeSourceSettingsController  = require('../controllers/settings/incomeSourceSettingsController');
const holidaySettingsController       = require('../controllers/settings/holidaySettingsController');
const communicationSettingsController = require('../controllers/settings/communicationSettingsController');

/* =============================================================================
   NEW controllers
============================================================================= */
const generalSettingsController   = require('../controllers/settings/generalSettingsController');
const apiSettingsController       = require('../controllers/settings/apiSettingsController');
const smsSettingsController       = require('../controllers/settings/smsSettingsController');
const emailSettingsController     = require('../controllers/settings/emailSettingsController');
const loanFeesController          = require('../controllers/settings/loanFeesController');
const loanRemindersController     = require('../controllers/settings/loanRemindersController');
const loanCyclesController        = require('../controllers/settings/loanCyclesController');
const loanTemplatesController     = require('../controllers/settings/loanTemplatesController');
const loanApprovalsController     = require('../controllers/settings/loanApprovalsController');

/* =============================================================================
   Guards & helpers
============================================================================= */
const ADMIN_ONLY     = authorizeRoles('admin', 'director');
const ADMIN_OR_HR    = authorizeRoles('admin', 'director', 'payroll_admin');
const ADMIN_OR_STAFF = authorizeRoles('admin', 'director', 'branch_manager');
const ANY_AUTH       = requireAuth;

// Access models via app (ensures the same Sequelize instance)
function getModels(req) {
  return req.app.get('models') || require('../models');
}
function tenantIdFrom(req) {
  return req.headers['x-tenant-id'] || req.context?.tenantId || null;
}
function rawJson(res, value, status = 200) {
  // Editors expect the raw JSON blob
  return res.status(status).json(value ?? {});
}

/* =============================================================================
   Quick status + sidebar
============================================================================= */
router.get('/status', authenticateUser, (req, res) => {
  res.json({
    ok: true,
    user: !!req.user?.id ? { id: req.user.id, role: req.user.role } : null,
    ts: new Date().toISOString(),
  });
});

router.get('/sidebar', authenticateUser, ANY_AUTH, (_req, res) => {
  res.json({
    items: [
      { path: '/',             label: 'Dashboard',            icon: 'home' },
      { path: '/borrowers',    label: 'Borrowers',            icon: 'users' },
      { path: '/loans',        label: 'Loans',                icon: 'credit-card' },
      { path: '/repayments',   label: 'Repayments',           icon: 'receipt' },
      { path: '/collateral',   label: 'Collateral Register',  icon: 'briefcase' },
      { path: '/collections',  label: 'Collection Sheets',    icon: 'calendar' },
      { path: '/savings',      label: 'Savings',              icon: 'wallet' },
      { path: '/investors',    label: 'Investors',            icon: 'briefcase' },
      { path: '/expenses',     label: 'Expenses',             icon: 'credit-card' },
      { path: '/other-income', label: 'Other Income',         icon: 'dollar-sign' },
      { path: '/assets',       label: 'Assets',               icon: 'package' },
      { path: '/accounting',   label: 'Accounting',           icon: 'database' },
      { path: '/reports',      label: 'Reports',              icon: 'bar-chart-2' },
      { path: '/payroll',      label: 'HR & Payroll',         icon: 'user-check' },
      { path: '/admin',        label: 'Admin',                icon: 'settings' },
    ],
    featureFlags: {
      collections:  true,
      savings:      true,
      investors:    true,
      collateral:   true,
      payroll:      true,
      hr:           true,
      expenses:     true,
      otherIncome:  true,
      accounting:   true,
      legacy:       false,
      esignatures:  false,
    },
  });
});

/* =============================================================================
   Loan Categories
============================================================================= */
router
  .route('/loan-categories')
  .get(authenticateUser, ANY_AUTH, loanCategoriesController.getLoanCategories)
  .post(authenticateUser, ADMIN_ONLY, loanCategoriesController.createLoanCategory);

router
  .route('/loan-categories/:id')
  .put(authenticateUser, ADMIN_ONLY, loanCategoriesController.updateLoanCategory)
  .delete(authenticateUser, ADMIN_ONLY, loanCategoriesController.deleteLoanCategory);

/* =============================================================================
   Loan Settings
============================================================================= */
router
  .route('/loan-settings')
  .get(authenticateUser, ANY_AUTH, loanSettingsController.getLoanSettings)
  .put(authenticateUser, ADMIN_ONLY, loanSettingsController.updateLoanSettings);

/* =============================================================================
   System Settings
============================================================================= */
router
  .route('/system-settings')
  .get(authenticateUser, ADMIN_ONLY, systemSettingsController.getSystemSettings)
  .put(authenticateUser, ADMIN_ONLY, systemSettingsController.updateSystemSettings);

/* =============================================================================
   Penalty Settings
============================================================================= */
router
  .route('/penalty-settings')
  .get(authenticateUser, ANY_AUTH, penaltySettingsController.getPenaltySettings)
  .put(authenticateUser, ADMIN_ONLY, penaltySettingsController.updatePenaltySettings);

/* =============================================================================
   Integration Settings
============================================================================= */
router
  .route('/integration-settings')
  .get(authenticateUser, ADMIN_ONLY, integrationSettingsController.getIntegrationSettings)
  .put(authenticateUser, ADMIN_ONLY, integrationSettingsController.updateIntegrationSettings);

/* =============================================================================
   Branch Settings
============================================================================= */
router
  .route('/branch-settings')
  .get(authenticateUser, ANY_AUTH, branchSettingsController.getBranchSettings);

router
  .put('/branch-settings/:id', authenticateUser, ADMIN_ONLY, branchSettingsController.updateBranchSettings);

/* =============================================================================
   Borrower Settings
============================================================================= */
router
  .route('/borrower-settings')
  .get(authenticateUser, ANY_AUTH, borrowerSettingsController.getBorrowerSettings)
  .put(authenticateUser, ADMIN_ONLY, borrowerSettingsController.updateBorrowerSettings);

/* =============================================================================
   User Management
============================================================================= */
router
  .route('/user-management')
  .get(authenticateUser, ADMIN_OR_STAFF, userManagementController.getUsers)
  .put(authenticateUser, ADMIN_ONLY, userManagementController.updateUser);

/* =============================================================================
   Bulk SMS
============================================================================= */
router
  .route('/bulk-sms-settings')
  .get(authenticateUser, ADMIN_ONLY, bulkSmsSettingsController.getBulkSmsSettings)
  .put(authenticateUser, ADMIN_ONLY, bulkSmsSettingsController.updateBulkSmsSettings);

/* =============================================================================
   Saving Account Settings
============================================================================= */
router
  .route('/saving-settings')
  .get(authenticateUser, ANY_AUTH, savingAccountSettingsController.getSavingAccountSettings)
  .put(authenticateUser, ADMIN_ONLY, savingAccountSettingsController.updateSavingAccountSettings);

/* =============================================================================
   Payroll Settings
============================================================================= */
router
  .route('/payroll-settings')
  .get(authenticateUser, ADMIN_OR_HR, payrollSettingsController.getPayrollSettings)
  .put(authenticateUser, ADMIN_OR_HR, payrollSettingsController.updatePayrollSettings);

/* =============================================================================
   Payment Settings
============================================================================= */
router
  .route('/payment-settings')
  .get(authenticateUser, ADMIN_ONLY, paymentSettingsController.getPaymentSettings)
  .put(authenticateUser, ADMIN_ONLY, paymentSettingsController.updatePaymentSettings);

/* =============================================================================
   Comment Settings
============================================================================= */
router
  .route('/comment-settings')
  .get(authenticateUser, ANY_AUTH, commentSettingsController.getCommentSettings)
  .put(authenticateUser, ADMIN_ONLY, commentSettingsController.updateCommentSettings);

/* =============================================================================
   Dashboard Settings
============================================================================= */
router
  .route('/dashboard-settings')
  .get(authenticateUser, ANY_AUTH, dashboardSettingsController.getDashboardSettings)
  .put(authenticateUser, ADMIN_ONLY, dashboardSettingsController.updateDashboardSettings);

/* =============================================================================
   Loan Sector Settings
============================================================================= */
router
  .route('/loan-sector-settings')
  .get(authenticateUser, ANY_AUTH, loanSectorSettingsController.getLoanSectorSettings)
  .put(authenticateUser, ADMIN_ONLY, loanSectorSettingsController.updateLoanSectorSettings);

/* =============================================================================
   Income Source Settings
============================================================================= */
router
  .route('/income-source-settings')
  .get(authenticateUser, ANY_AUTH, incomeSourceSettingsController.getIncomeSourceSettings)
  .put(authenticateUser, ADMIN_ONLY, incomeSourceSettingsController.updateIncomeSourceSettings);

/* =============================================================================
   Holiday Settings
============================================================================= */
router
  .route('/holiday-settings')
  .get(authenticateUser, ANY_AUTH, holidaySettingsController.getHolidaySettings)
  .put(authenticateUser, ADMIN_ONLY, holidaySettingsController.updateHolidaySettings);

/* =============================================================================
   Communications
============================================================================= */
router
  .route('/communications')
  .get(authenticateUser, ANY_AUTH, communicationSettingsController.listCommunications)
  .post(authenticateUser, ADMIN_ONLY, communicationSettingsController.createCommunication);

router
  .route('/communications/:id')
  .get(authenticateUser, ANY_AUTH, communicationSettingsController.getCommunication)
  .put(authenticateUser, ADMIN_ONLY, communicationSettingsController.updateCommunication)
  .delete(authenticateUser, ADMIN_ONLY, communicationSettingsController.deleteCommunication);

router.post(
  '/communications/:id/attachments',
  authenticateUser,
  ADMIN_ONLY,
  communicationSettingsController.addAttachment
);

router.delete(
  '/communications/:id/attachments/:attId',
  authenticateUser,
  ADMIN_ONLY,
  communicationSettingsController.removeAttachment
);

/* =============================================================================
   NEW — General / API / SMS / Email
============================================================================= */
router
  .route('/general')
  .get(authenticateUser, ANY_AUTH, generalSettingsController.getGeneral)
  .put(authenticateUser, ADMIN_ONLY, generalSettingsController.updateGeneral);

router
  .route('/api')
  .get(authenticateUser, ADMIN_ONLY, apiSettingsController.getApiSettings)
  .put(authenticateUser, ADMIN_ONLY, apiSettingsController.updateApiSettings);

router
  .route('/sms')
  .get(authenticateUser, ADMIN_ONLY, smsSettingsController.getSmsSettings)
  .put(authenticateUser, ADMIN_ONLY, smsSettingsController.updateSmsSettings);

router
  .route('/email')
  .get(authenticateUser, ADMIN_ONLY, emailSettingsController.getEmailSettings)
  .put(authenticateUser, ADMIN_ONLY, emailSettingsController.updateEmailSettings);

/* =============================================================================
   NEW — Loans: Fees / Reminders / Cycles / Templates / Approvals
============================================================================= */
router
  .route('/loan-fees')
  .get(authenticateUser, ANY_AUTH, loanFeesController.getLoanFees)
  .put(authenticateUser, ADMIN_ONLY, loanFeesController.updateLoanFees);

router
  .route('/loan-reminders')
  .get(authenticateUser, ANY_AUTH, loanRemindersController.getLoanReminders)
  .put(authenticateUser, ADMIN_ONLY, loanRemindersController.updateLoanReminders);

router
  .route('/loan-repayment-cycles')
  .get(authenticateUser, ANY_AUTH, loanCyclesController.getLoanCycles)
  .put(authenticateUser, ADMIN_ONLY, loanCyclesController.updateLoanCycles);

router
  .route('/loan-templates')
  .get(authenticateUser, ANY_AUTH, loanTemplatesController.getLoanTemplates)
  .put(authenticateUser, ADMIN_ONLY, loanTemplatesController.updateLoanTemplates);

router
  .route('/loan-approvals')
  .get(authenticateUser, ANY_AUTH, loanApprovalsController.getLoanApprovals)
  .put(authenticateUser, ADMIN_ONLY, loanApprovalsController.updateLoanApprovals);

/* =============================================================================
   GENERIC SETTINGS STORE (tenant-aware via Setting model)
   (Specific routes above take precedence)
============================================================================= */

// helpers reused in both legacy and kv aliases
async function getValue(req) {
  const { Setting } = getModels(req);
  const key = String(req.params.key || req.query.key || '').trim();
  if (!key) throw Object.assign(new Error('key is required'), { status: 400 });
  return Setting.get(key, {}, { tenantId: tenantIdFrom(req) });
}
async function putValue(req) {
  const { Setting } = getModels(req);
  const key = String(req.params.key || req.body?.key || '').trim();
  if (!key) throw Object.assign(new Error('key is required'), { status: 400 });

  const body = req.body ?? {};
  const value = Object.prototype.hasOwnProperty.call(body, 'value') ? body.value : body;
  return Setting.set(key, value ?? {}, {
    tenantId: tenantIdFrom(req),
    updatedBy: req.user?.id || null,
    createdBy: req.user?.id || null,
  });
}
async function patchValue(req) {
  const { Setting } = getModels(req);
  const key = String(req.params.key || req.body?.key || '').trim();
  if (!key) throw Object.assign(new Error('key is required'), { status: 400 });

  const body = req.body ?? {};
  const patch = Object.prototype.hasOwnProperty.call(body, 'patch') ? body.patch : body;
  if (patch && typeof patch !== 'object') {
    throw Object.assign(new Error('patch must be an object'), { status: 400 });
  }
  return Setting.merge(key, patch || {}, {
    tenantId: tenantIdFrom(req),
    updatedBy: req.user?.id || null,
  });
}

// Legacy forms
router.get('/', authenticateUser, ANY_AUTH, async (req, res, next) => {
  try { rawJson(res, await getValue(req)); } catch (e) { next(e); }
});
router.put('/', authenticateUser, ADMIN_ONLY, async (req, res, next) => {
  try { rawJson(res, await putValue(req)); } catch (e) { next(e); }
});
router.patch('/', authenticateUser, ADMIN_ONLY, async (req, res, next) => {
  try { rawJson(res, await patchValue(req)); } catch (e) { next(e); }
});
router.get('/:key', authenticateUser, ANY_AUTH, async (req, res, next) => {
  try { rawJson(res, await getValue(req)); } catch (e) { next(e); }
});
router.put('/:key', authenticateUser, ADMIN_ONLY, async (req, res, next) => {
  try { rawJson(res, await putValue(req)); } catch (e) { next(e); }
});
router.patch('/:key', authenticateUser, ADMIN_ONLY, async (req, res, next) => {
  try { rawJson(res, await patchValue(req)); } catch (e) { next(e); }
});

/* =============================================================================
   KV ALIASES (the new editors call these)
   These are just clean aliases to the same logic above.
============================================================================= */
router.get('/kv/:key', authenticateUser, ANY_AUTH, async (req, res, next) => {
  try { rawJson(res, await getValue(req)); } catch (e) { next(e); }
});
router.put('/kv/:key', authenticateUser, ADMIN_ONLY, async (req, res, next) => {
  try { rawJson(res, await putValue(req)); } catch (e) { next(e); }
});
router.patch('/kv/:key', authenticateUser, ADMIN_ONLY, async (req, res, next) => {
  try { rawJson(res, await patchValue(req)); } catch (e) { next(e); }
});

module.exports = router;
