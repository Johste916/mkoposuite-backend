const express = require('express');
const router = express.Router();
const {
  getDashboardSummary,
  getDefaulters,
  getMonthlyTrends,
  getActivityFeed,
  addActivityComment,
  assignActivityTask,
  getGeneralCommunications, // must match controller export
} = require('../controllers/dashboardController');
const { authenticateUser } = require('../middleware/authMiddleware');

router.get('/summary', authenticateUser, getDashboardSummary);
router.get('/defaulters', authenticateUser, getDefaulters);
router.get('/monthly-trends', authenticateUser, getMonthlyTrends);
router.get('/activity', authenticateUser, getActivityFeed);
router.post('/activity/:id/comment', authenticateUser, addActivityComment);
router.post('/activity/:id/assign', authenticateUser, assignActivityTask);
router.get('/communications', authenticateUser, getGeneralCommunications);

module.exports = router;
