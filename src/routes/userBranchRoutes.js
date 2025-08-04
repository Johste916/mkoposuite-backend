const express = require('express');
const router = express.Router();
const userBranchController = require('../controllers/userBranchController');

router.post('/assign', userBranchController.assignBranch);

module.exports = router;
