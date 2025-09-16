// routes/userBranchRoutes.js
'use strict';
const express = require('express');
const router = express.Router();

let authenticateUser = (_req, _res, next) => next();
try {
  authenticateUser = require('../middleware/authMiddleware').authenticateUser || authenticateUser;
} catch {}

const ctrl = require('../controllers/userBranchController');

router.use(authenticateUser);

// POST /api/user-branches/assign  { branchId, userIds[] }
router.post('/assign', ctrl.assignBranch);

module.exports = router;
