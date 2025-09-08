// server/routes/supportRoutes.js
'use strict';
const express = require('express');
const router = express.Router();

router.post('/tickets', (req, res) => {
  const { subject, body, priority, source, tenantId } = req.body || {};
  const id = Date.now().toString(36);
  // TODO: persist to DB or forward to helpdesk
  res.status(201).json({ id, subject, priority: priority || 'normal', source: source || 'admin', tenantId, status: 'open' });
});

module.exports = router;
