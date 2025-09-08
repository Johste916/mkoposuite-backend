// routes/enrichmentRoutes.js
'use strict';
const express = require('express');
const router = express.Router();

router.get('/phone', (req, res) => {
  const phone = String(req.query.phone || '').trim();
  if (!phone) return res.fail(400, 'phone query is required');
  return res.ok({
    phone,
    e164: phone.startsWith('+') ? phone : `+${phone}`,
    countryHint: 'TZ',
    carrierHint: 'Vodacom',
    lineType: 'mobile',
    risk: { disposable: false, recentPort: false, score: 0.1 },
  });
});

router.get('/email', (req, res) => {
  const email = String(req.query.email || '').trim();
  if (!email) return res.fail(400, 'email query is required');
  const domain = email.includes('@') ? email.split('@')[1] : '';
  return res.ok({
    email,
    domain,
    deliverability: 'unknown',
    mxPresent: true,
    disposable: false,
  });
});

router.get('/org', (req, res) => {
  const name = String(req.query.name || '').trim();
  if (!name) return res.fail(400, 'name query is required');
  return res.ok({
    name,
    industry: 'Microfinance',
    size: '11-50',
    website: null,
    location: null,
  });
});

module.exports = router;
