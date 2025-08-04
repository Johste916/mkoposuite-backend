const express = require('express');
const router = express.Router();
const userRoleController = require('../controllers/userRoleController');

router.post('/assign', userRoleController.assignRole);

module.exports = router;
