const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');

// ✅ Login route (used by Postman or frontend)
router.post('/login', authController.login);

// ✅ Temporary test route (to verify deployment)
router.get('/test', (req, res) => {
  res.json({ message: '✅ Auth route is working!' });
});

module.exports = router;
