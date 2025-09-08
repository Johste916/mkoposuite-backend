// server/routes/plansRoutes.js
'use strict';
const express = require('express');
const router = express.Router();

const PLANS = [
  { code: 'basic',    name: 'Basic' },
  { code: 'pro',      name: 'Pro' },
  { code: 'premium',  name: 'Premium' },
];

router.get('/', (_req, res) => {
  // Support both shapes: array OR {plans:[…]}
  const shape = (_req.query.shape || '').toLowerCase();
  if (shape === 'array') return res.json(PLANS);
  return res.json({ plans: PLANS });
});

module.exports = router;
