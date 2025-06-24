const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');

// ✅ Login route
router.post('/login', authController.login);

// ✅ Health test
router.get('/test', (req, res) => {
  res.json({ message: 'Backend is running locally ✅' });
});

module.exports = router;
