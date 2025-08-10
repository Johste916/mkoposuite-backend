// src/routes/loanProductRoutes.js
const express = require('express');
const router = express.Router();
const { authenticateUser } = require('../middleware/authMiddleware');
const ctrl = require('../controllers/loanProductController');

// List & read
router.get('/', authenticateUser, ctrl.list);
router.get('/:id', authenticateUser, ctrl.get);

// Create/Update/Delete
router.post('/', authenticateUser, ctrl.create);
router.put('/:id', authenticateUser, ctrl.update);
router.delete('/:id', authenticateUser, ctrl.remove);

// Quick status toggle
router.patch('/:id/toggle', authenticateUser, ctrl.toggleStatus);

module.exports = router;
