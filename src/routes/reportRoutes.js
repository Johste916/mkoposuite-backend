const express = require('express');
const router = express.Router();
const reportController = require('../controllers/reportController');
const { authenticateToken } = require('../middleware/authMiddleware');

// 📊 Summary data (counts, totals)
router.get('/summary', authenticateToken, reportController.getSummary);

// 📈 Monthly trends
router.get('/trends', authenticateToken, reportController.getTrends);

// 📄 Export to CSV
router.get('/export/csv', authenticateToken, reportController.exportCSV);

// 📄 Export to PDF
router.get('/export/pdf', authenticateToken, reportController.exportPDF);

module.exports = router;
