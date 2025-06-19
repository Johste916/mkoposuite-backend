// backend/src/routes/dashboardRoutes.js
const express = require('express');
const router = express.Router();
const authenticateToken = require('../middleware/authMiddleware');
const authorize = require('../middleware/roleMiddleware');
const dashboardController = require('../controllers/dashboardController');

// ✅ Summary data for dashboard
router.get(
  '/summary',
  authenticateToken,
  authorize(),
  dashboardController.getDashboardSummary
);

// ✅ Defaulters list
router.get(
  '/defaulters',
  authenticateToken,
  authorize(),
  dashboardController.getDefaulters
);

module.exports = router;