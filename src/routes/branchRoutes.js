const express = require('express');
const router = express.Router();
const { authenticateUser } = require('../middleware/authMiddleware');
const branchController = require('../controllers/branchController');

router.get('/', authenticateUser, branchController.getBranches);
router.post('/', authenticateUser, branchController.createBranch);

module.exports = router;
