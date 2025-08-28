const express = require('express');
const router = express.Router();
const reportController = require('../controllers/reportController');
const { authenticateUser } = require('../middleware/authMiddleware');

// -------- Filters (branches, officers, borrowers) --------
router.get('/filters', authenticateUser, reportController.getFilters);

// -------- Dashboard-style summary + trends --------
router.get('/summary', authenticateUser, reportController.getSummary);
router.get('/trends', authenticateUser, reportController.getTrends);

// -------- Loan Summary (scoped + date-range aware) --------
router.get('/loan-summary', authenticateUser, reportController.getLoanSummary);

// -------- Exports --------
router.get('/export/csv', authenticateUser, reportController.exportCSV);
router.get('/export/pdf', authenticateUser, reportController.exportPDF);

// Back-compat aliases (so older frontends continue working)
router.get('/export-csv', authenticateUser, reportController.exportCSV);
router.get('/export-pdf', authenticateUser, reportController.exportPDF);

module.exports = router;
