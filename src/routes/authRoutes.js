const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');

// ✅ Main login route
router.post('/login', authController.login);

// ✅ Debugging route to confirm deployment
router.get('/test', (req, res) => {
  res.json({ message: '✅ Auth route is working!' });
});

module.exports = router;
