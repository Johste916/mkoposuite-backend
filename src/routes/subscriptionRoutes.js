// routes/subscriptionRoutes.js
'use strict';
const express = require('express');
const router = express.Router();

router.get('/', async (req, res) => {
  try {
    // System/global subscription (not per-tenant)
    return res.ok({
      plan: process.env.SYSTEM_PLAN || 'pro',
      status: 'active',
      provider: 'fallback',
      seats: 'unlimited',
      trialEndsAt: null,
      renewsAt: null,
      features: ['support-console','impersonation','tickets','sms','billing-by-phone','enrichment'],
    });
  } catch (e) { return res.fail(500, e.message); }
});

module.exports = router;
