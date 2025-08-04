const express = require('express');
const router = express.Router();
const reportController = require('../controllers/reportController');
const { authenticateUser } = require('../middleware/authMiddleware');

// 📊 Summary data (counts, totals)
router.get('/summary', authenticateUser, reportController.getSummary);

// 📈 Monthly trends
router.get('/trends', authenticateUser, reportController.getTrends);

// 📄 Export to CSV
router.get('/export/csv', authenticateUser, reportController.exportCSV);

// 📄 Export to PDF
router.get('/export/pdf', authenticateUser, reportController.exportPDF);

module.exports = router;
