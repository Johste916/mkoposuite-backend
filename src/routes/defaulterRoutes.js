const express = require('express');
const router = express.Router();
const verifyToken = require('../middleware/authMiddleware');
const { getDefaulters } = require('../controllers/defaulterController');

router.get('/', verifyToken, getDefaulters);

module.exports = router;
