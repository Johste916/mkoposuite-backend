const express = require('express');
const router = express.Router();
const { authenticateUser } = require('../middleware/authMiddleware');
const groupReportsCtrl = require('../controllers/groupReportsController');

// Existing group routes here...

// 📌 New Reports Endpoint
router.get('/reports/summary', authenticateUser, groupReportsCtrl.getGroupSummary);

module.exports = router;
