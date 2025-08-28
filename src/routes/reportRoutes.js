const express = require('express');
const router = express.Router();
const reportController = require('../controllers/reportController');
const { authenticateUser } = require('../middleware/authMiddleware');

// 📊 Summary data (counts, totals)
router.get('/summary', authenticateUser, reportController.getSummary);

// 📈 Monthly trends
router.get('/trends', authenticateUser, reportController.getTrends);

// 🧮 Loan Summary with filters (branch/officer/timeRange)
router.get('/loan-summary', authenticateUser, reportController.getLoanSummary);

// 📄 Export to CSV (supports same filters)
router.get('/export/csv', authenticateUser, reportController.exportCSV);
// alias for back-compat if UI calls /export-csv
router.get('/export-csv', authenticateUser, reportController.exportCSV);

// 📄 Export to PDF (supports same filters)
router.get('/export/pdf', authenticateUser, reportController.exportPDF);
// alias for back-compat if UI calls /export-pdf
router.get('/export-pdf', authenticateUser, reportController.exportPDF);

module.exports = router;
