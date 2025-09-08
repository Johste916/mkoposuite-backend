// routes/smsRoutes.js
'use strict';
const express = require('express');
const router = express.Router();

const logs = [];

router.post('/send', async (req, res) => {
  const { to, message, from } = req.body || {};
  if (!to || !message) return res.fail(400, 'to and message are required');
  // Hook a real SMS provider here if available
  const item = { id: Date.now(), tenantId: null, to: String(to), from: from || 'MkopoSuite', message: String(message), at: new Date().toISOString(), status: 'queued' };
  logs.push(item);
  return res.ok({ ok: true, messageId: item.id, status: item.status });
});

router.get('/logs', (_req, res) => res.ok({ items: logs.slice(-100) }));

module.exports = router;
