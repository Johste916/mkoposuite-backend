// backend/src/routes/permissionRoutes.js
const router = require('express').Router();
const { authenticateUser } = require('../middleware/authMiddleware');
const { allow } = require('../middleware/permissions');
const { getPermissions, updatePermission } = require('../controllers/permissionsController');

// JWT first, then permission checks.
// Clearer actions than "manageSettings":
router.get('/', authenticateUser, allow('permissions.read'), getPermissions);
router.put('/:action', authenticateUser, allow('permissions.update'), updatePermission);

module.exports = router;
