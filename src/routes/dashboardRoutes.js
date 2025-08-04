const express = require('express');
const router = express.Router();
const { getDashboardSummary, getDefaulters } = require('../controllers/dashboardController');
const authenticate = require('../middleware/authMiddleware'); // this is a function

router.get('/summary', authenticate, getDashboardSummary);
router.get('/defaulters', authenticate, getDefaulters);

module.exports = router;
