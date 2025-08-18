// backend/src/routes/roleRoutes.js
const express = require('express');
const router = express.Router();
const { authenticateUser } = require('../middleware/authMiddleware');
const roleController = require('../controllers/roleController');

// These can also be protected with permission checks if you prefer:
// e.g. allow('manageRoles')
router.get('/', authenticateUser, roleController.getAllRoles);
router.post('/', authenticateUser, roleController.createRole);

module.exports = router;
