const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');

// POST /api/login
router.post('/login', authController.login);

// Optional test route for debugging
router.get('/test', (req, res) => {
  res.json({ message: '✅ Auth route is working!' });
});

module.exports = router;
