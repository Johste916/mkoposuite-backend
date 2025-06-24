const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');

// ✅ Login route
router.post('/login', authController.login);

// ✅ Test route
router.get('/test', (req, res) => {
  res.json({ message: '✅ Auth route is working!' });
});

module.exports = router;
