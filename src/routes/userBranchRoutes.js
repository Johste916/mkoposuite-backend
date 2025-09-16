// backend/src/routes/userBranchRoutes.js
const express = require('express');
const router = express.Router();

let authenticateUser = (_req, _res, next) => next();
try {
  authenticateUser = require('../middleware/authMiddleware').authenticateUser || authenticateUser;
} catch {}

let userBranchController;
try { userBranchController = require('../controllers/userBranchController'); } catch { userBranchController = null; }

router.use(authenticateUser);

if (!userBranchController) {
  router.all('*', (_req, res) => res.status(501).json({ error: 'userBranchController not available' }));
} else {
  // Assign user to a branch
  router.post('/assign', userBranchController.assignBranch);
}

module.exports = router;
