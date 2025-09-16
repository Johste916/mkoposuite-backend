// backend/src/routes/userRoleRoutes.js
const express = require('express');
const router = express.Router();

let authenticateUser = (_req, _res, next) => next();
try {
  authenticateUser = require('../middleware/authMiddleware').authenticateUser || authenticateUser;
} catch {}

let userRoleController;
try { userRoleController = require('../controllers/userRoleController'); } catch { userRoleController = null; }

router.use(authenticateUser);

if (!userRoleController) {
  router.all('*', (_req, res) => res.status(501).json({ error: 'userRoleController not available' }));
} else {
  // Assign a single role to a user (idempotent upsert—your controller should handle duplicates)
  router.post('/assign', userRoleController.assignRole);
}

module.exports = router;
