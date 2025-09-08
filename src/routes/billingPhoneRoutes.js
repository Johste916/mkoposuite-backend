// routes/billingPhoneRoutes.js
'use strict';
const express = require('express');
const router = express.Router();

router.get('/lookup', (req, res) => {
  const phone = String(req.query.phone || '').trim();
  if (!phone) return res.fail(400, 'phone query is required');
  // Replace with your billing provider lookup
  return res.ok({
    phone,
    customerId: `CUS-${phone.slice(-6) || '000000'}`,
    name: 'Demo Customer',
    balance: 0,
    invoicesCount: 0,
    lastInvoiceAt: null,
  });
});

module.exports = router;
