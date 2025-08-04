const express = require('express');
const router = express.Router();
const { getDashboardSummary, getDefaulters } = require('../controllers/dashboardController');
const { authenticateUser } = require('../middleware/authMiddleware'); // ✅ Fix here

router.get('/summary', authenticateUser, getDashboardSummary);
router.get('/defaulters', authenticateUser, getDefaulters);

module.exports = router;
