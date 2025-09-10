'use strict';
const express = require('express');
const router = express.Router();
const { signup, selfcheck } = require('../controllers/publicSignupController');

// ✅ Public endpoints
router.get('/_selfcheck', selfcheck);   // quick status probe
router.post('/', signup);               // POST /api/signup

module.exports = router;
