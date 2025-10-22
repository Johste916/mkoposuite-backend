const express = require('express');
const router = express.Router();
const { authenticateUser } = require('../middleware/authMiddleware');
const groupReportsCtrl = require('../controllers/groupReportsController');

// Other group routes...
router.get('/reports/summary', authenticateUser, groupReportsCtrl.getGroupSummary);

module.exports = router;
