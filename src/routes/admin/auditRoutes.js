// backend/src/routes/admin/auditRoutes.js
const express = require('express');
const router = express.Router();

const { authenticateUser } = require('../../middleware/authMiddleware');
const audit = require('../../controllers/admin/auditController');

// List & create logs
router.get('/', authenticateUser, audit.list);
router.post('/', authenticateUser, audit.create);

// Ops your UI expects
router.delete('/:id', authenticateUser, audit.remove);
router.post('/:id/reverse', authenticateUser, audit.reverse);

module.exports = router;
