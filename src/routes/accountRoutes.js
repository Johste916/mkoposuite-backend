'use strict';
const express = require('express');
const router = express.Router();
const { authenticateUser } = require('../middleware/authMiddleware');

router.get('/settings/billing', authenticateUser, (_req, res) => {
  res.json({
    plan: 'free',
    status: 'ok',
    seats: 1,
    renewsAt: null
  });
});

module.exports = router;
