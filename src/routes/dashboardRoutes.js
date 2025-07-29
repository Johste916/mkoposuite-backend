// src/routes/dashboardRoutes.js
const express = require('express');
const router = express.Router();
const dashboardController = require('../controllers/dashboardController');
const authenticate = require('../middleware/authMiddleware');

router.get('/summary', authenticate, dashboardController.getDashboardSummary);
router.get('/defaulters', authenticate, dashboardController.getDefaulters);

module.exports = router;
