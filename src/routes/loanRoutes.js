'use strict';

const express = require('express');
const router = express.Router();
const multer = require('multer');
const upload = multer(); // memory storage for multipart bodies

// Auth
const { authenticateUser } = require('../middleware/authMiddleware');

// Keep controller as an object (no destructuring to avoid undefineds)
const ctrl = require('../controllers/loanController');

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

/* ------------------------------- CRUD -------------------------------- */

// List
router.get('/', authenticateUser, h('getAllLoans'));

// Create — accept JSON or multipart
router.post('/', authenticateUser, upload.any(), h('createLoan'));

// Read
router.get('/:id', authenticateUser, h('getLoanById'));

// Update — accept JSON or multipart
router.put('/:id', authenticateUser, upload.any(), h('updateLoan'));

// Delete — IMPORTANT: do NOT reference a bare `deleteLoan`
router.delete('/:id', authenticateUser, h('deleteLoan'));

/* -------------------------- Status transitions ----------------------- */

// Support both PATCH and POST (some frontends POST action buttons)
['patch', 'post'].forEach((verb) => {
  router[verb]('/:id/approve',  authenticateUser, upload.none(), setStatus('approved'));
  router[verb]('/:id/reject',   authenticateUser, upload.none(), setStatus('rejected'));
  router[verb]('/:id/disburse', authenticateUser, upload.none(), setStatus('disbursed'));
  router[verb]('/:id/close',    authenticateUser, upload.none(), setStatus('closed'));
});

// Generic (status in body)
router.patch('/:id/status', authenticateUser, upload.any(), h('updateLoanStatus'));
router.post('/:id/status',  authenticateUser, upload.any(), h('updateLoanStatus'));

// Generic (status in path param)
router.patch('/:id/status/:status', authenticateUser, upload.none(), (req, res, next) => {
  req.body = req.body || {};
  req.body.status = req.params.status;
  return h('updateLoanStatus')(req, res, next);
});
router.post('/:id/status/:status', authenticateUser, upload.none(), (req, res, next) => {
  req.body = req.body || {};
  req.body.status = req.params.status;
  return h('updateLoanStatus')(req, res, next);
});

/* ------------------------------ Schedule ----------------------------- */
// Controller supports :loanId or :id
router.get('/:loanId/schedule', authenticateUser, h('getLoanSchedule'));
router.get('/:id/schedule',     authenticateUser, (req, res, next) => {
  req.params.loanId = req.params.id;
  return h('getLoanSchedule')(req, res, next);
});

// Alias for compatibility (some UIs might call /:id/installments)
router.get('/:id/installments', authenticateUser, (req, res, next) => {
  req.params.loanId = req.params.id;
  return h('getLoanSchedule')(req, res, next);
});

/* --------------------------- Schedule Export -------------------------- */
/** 
 * Non-breaking: these routes only respond if the controller implements
 * exportLoanScheduleCsv / exportLoanSchedulePdf. Otherwise they return 501
 * (via the safe wrapper), which won’t affect existing flows.
 */
router.get('/:loanId/schedule/export.csv', authenticateUser, h('exportLoanScheduleCsv'));
router.get('/:id/schedule/export.csv',     authenticateUser, (req, res, next) => {
  req.params.loanId = req.params.id;
  return h('exportLoanScheduleCsv')(req, res, next);
});

router.get('/:loanId/schedule/export.pdf', authenticateUser, h('exportLoanSchedulePdf'));
router.get('/:id/schedule/export.pdf',     authenticateUser, (req, res, next) => {
  req.params.loanId = req.params.id;
  return h('exportLoanSchedulePdf')(req, res, next);
});

/* ------------------------------- Export ------------------------------ */
module.exports = router;
module.exports.default = router; // some loaders expect .default
module.exports.router = router;  // others expect .router
