// backend/src/routes/exportRoutes.js

const express = require('express');
const router = express.Router();

const exportController = require('../controllers/exportController');

// 🔓 Temporarily no auth for easier testing – add back later
// const authenticateToken = require('../middleware/authMiddleware');
// const authorize = require('../middleware/roleMiddleware');

// 📦 Export Defaulters as PDF or CSV
router.get('/:format', exportController.exportDefaulters);

module.exports = router;
