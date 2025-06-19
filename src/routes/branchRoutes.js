const express = require('express');
const router = express.Router();
const { createBranch, getAllBranches } = require('../controllers/branchController');
const verifyToken = require('../middleware/authMiddleware');

router.post('/', verifyToken, createBranch);
router.get('/', verifyToken, getAllBranches);

module.exports = router;
