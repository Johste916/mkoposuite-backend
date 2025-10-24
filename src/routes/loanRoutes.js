'use strict';

const express = require('express');
const router = express.Router();
const multer = require('multer');
const upload = multer(); // memory storage for multipart bodies

// Auth
const { authenticateUser } = require('../middleware/authMiddleware');

// Keep controller as an object (no destructuring to avoid undefineds)
const ctrl = require('../controllers/loanController');

// NEW: dedicated status controller powering Loans › status pages
const statusCtrl = require('../controllers/loansStatus');

/** Safe wrapper: always pass a function to Express */
const h = (name) => (req, res, next) => {
  if (ctrl && typeof ctrl[name] === 'function') return ctrl[name](req, res, next);
  return res.status(501).json({ error: `Controller method ${name} is not implemented` });
};

/** Map simple status endpoints to updateLoanStatus */
const setStatus = (status) => (req, res, next) => {
  req.body = req.body || {};
  req.body.status = status; // controller lowercases/validates
  return h('updateLoanStatus')(req, res, next);
};

/** Helper to call list with a forced query param (legacy compatibility) */
const listWith = (key, value) => (req, res, next) => {
  req.query = { ...req.query, [key]: value };
  return h('getAllLoans')(req, res, next);
};

/* ---------------------------- NEW: status endpoints ------------------------ */
// Flexible endpoint: /api/loans/status?status=disbursed&startDate=...&endDate=...
router.get('/status', authenticateUser, statusCtrl.listByStatus);

// Explicit routes (so frontend can call clean URLs)
router.get('/status/disbursed',             authenticateUser, (req, res) => statusCtrl.listByStatus({ ...req, query: { ...req.query, status: 'disbursed' } }, res));
router.get('/status/due',                   authenticateUser, (req, res) => statusCtrl.listByStatus({ ...req, query: { ...req.query, status: 'due' } }, res));
router.get('/status/missed',                authenticateUser, (req, res) => statusCtrl.listByStatus({ ...req, query: { ...req.query, status: 'missed' } }, res));
router.get('/status/arrears',               authenticateUser, (req, res) => statusCtrl.listByStatus({ ...req, query: { ...req.query, status: 'arrears' } }, res));
router.get('/status/no-repayments',         authenticateUser, (req, res) => statusCtrl.listByStatus({ ...req, query: { ...req.query, status: 'no-repayments' } }, res));
router.get('/status/past-maturity',         authenticateUser, (req, res) => statusCtrl.listByStatus({ ...req, query: { ...req.query, status: 'past-maturity' } }, res));
router.get('/status/1-month-late',          authenticateUser, (req, res) => statusCtrl.listByStatus({ ...req, query: { ...req.query, status: '1-month-late' } }, res));
router.get('/status/3-months-late',         authenticateUser, (req, res) => statusCtrl.listByStatus({ ...req, query: { ...req.query, status: '3-months-late' } }, res));
router.get('/status/principal-outstanding', authenticateUser, (req, res) => statusCtrl.listByStatus({ ...req, query: { ...req.query, status: 'principal-outstanding' } }, res));

/* --------------------------------- CRUD ----------------------------------- */

// List (legacy)
router.get('/', authenticateUser, h('getAllLoans'));

// Friendly legacy shortcuts (kept for compatibility)
router.get('/disbursed', authenticateUser, listWith('status', 'disbursed'));
router.get('/approved',  authenticateUser, listWith('status', 'approved'));
router.get('/pending',   authenticateUser, listWith('status', 'pending'));
router.get('/rejected',  authenticateUser, listWith('status', 'rejected'));
router.get('/closed',    authenticateUser, listWith('status', 'closed'));
router.get('/active',    authenticateUser, listWith('scope',  'active'));

// Create — accept JSON or multipart
router.post('/', authenticateUser, upload.any(), h('createLoan'));

// Read (numeric id only to avoid catching /disbursed, etc.)
router.get('/:id(\\d+)', authenticateUser, h('getLoanById'));

// Update — accept JSON or multipart (support PATCH as well)
router.put('/:id(\\d+)', authenticateUser, upload.any(), h('updateLoan'));
router.patch('/:id(\\d+)', authenticateUser, upload.any(), h('updateLoan'));

// Delete
router.delete('/:id(\\d+)', authenticateUser, h('deleteLoan'));

/* -------------------------- Status transitions ----------------------- */
['patch', 'post'].forEach((verb) => {
  router[verb]('/:id(\\d+)/approve',  authenticateUser, upload.none(), setStatus('approved'));
  router[verb]('/:id(\\d+)/reject',   authenticateUser, upload.none(), setStatus('rejected'));
  router[verb]('/:id(\\d+)/disburse', authenticateUser, upload.none(), setStatus('disbursed'));
  router[verb]('/:id(\\d+)/close',    authenticateUser, upload.none(), setStatus('closed'));
});

// Generic (status in body or path)
router.patch('/:id(\\d+)/status', authenticateUser, upload.any(), h('updateLoanStatus'));
router.post('/:id(\\d+)/status',  authenticateUser, upload.any(), h('updateLoanStatus'));
router.patch('/:id(\\d+)/status/:status', authenticateUser, upload.none(), (req, res, next) => {
  req.body = req.body || {}; req.body.status = req.params.status; return h('updateLoanStatus')(req, res, next);
});
router.post('/:id(\\d+)/status/:status',  authenticateUser, upload.none(), (req, res, next) => {
  req.body = req.body || {}; req.body.status = req.params.status; return h('updateLoanStatus')(req, res, next);
});

/* ------------------------------ Schedule ----------------------------- */
router.get('/:loanId(\\d+)/schedule', authenticateUser, h('getLoanSchedule'));
router.get('/:id(\\d+)/schedule',     authenticateUser, (req, res, next) => { req.params.loanId = req.params.id; return h('getLoanSchedule')(req, res, next); });
router.get('/:id(\\d+)/installments', authenticateUser, (req, res, next) => { req.params.loanId = req.params.id; return h('getLoanSchedule')(req, res, next); });

// Schedule export (optional)
router.get('/:loanId(\\d+)/schedule/export.csv', authenticateUser, h('exportLoanScheduleCsv'));
router.get('/:id(\\d+)/schedule/export.csv',     authenticateUser, (req, res, next) => { req.params.loanId = req.params.id; return h('exportLoanScheduleCsv')(req, res, next); });
router.get('/:loanId(\\d+)/schedule/export.pdf', authenticateUser, h('exportLoanSchedulePdf'));
router.get('/:id(\\d+)/schedule/export.pdf',     authenticateUser, (req, res, next) => { req.params.loanId = req.params.id; return h('exportLoanSchedulePdf')(req, res, next); });

/* ---------------------- Reissue / Reschedule ------------------------- */
router.post('/:id(\\d+)/reschedule', authenticateUser, upload.any(), h('rescheduleLoan'));
router.post('/:id(\\d+)/resissue',   authenticateUser, upload.any(), h('rescheduleLoan')); // alias
router.post('/:id(\\d+)/reissue',    authenticateUser, upload.any(), h('reissueLoan'));

/* -------------------------------- Export ------------------------------ */
module.exports = router;
module.exports.default = router;
module.exports.router = router;
