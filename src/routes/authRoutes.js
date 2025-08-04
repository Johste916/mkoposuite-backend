const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');

// ✅ Route: POST /api/login
router.post('/', authController.login);  // NOT /login

module.exports = router;
