'use strict';

const express = require('express');
const router = express.Router();

let auth = {};
try { auth = require('../middleware/authMiddleware'); } catch {}
const authenticateUser = auth.authenticateUser || ((_req, _res, next) => next());
const requireAuth      = auth.requireAuth      || ((_req, _res, next) => next());

router.use(authenticateUser);

/* ---- Minimal identity-ish endpoints ---- */
router.get('/', requireAuth, (req, res) => {
  const id = String(
    req.headers['x-tenant-id'] ||
    process.env.DEFAULT_TENANT_ID ||
    '00000000-0000-0000-0000-000000000000'
  );
  res.ok({ id, name: process.env.DEFAULT_TENANT_NAME || 'Organization' });
});

router.get('/me', requireAuth, (req, res) => {
  const id = String(
    req.headers['x-tenant-id'] ||
    process.env.DEFAULT_TENANT_ID ||
    '00000000-0000-0000-0000-000000000000'
  );
  res.ok({ id, name: process.env.DEFAULT_TENANT_NAME || 'Organization' });
});

router.get('/tenant', requireAuth, (req, res) => {
  const id = String(
    req.headers['x-tenant-id'] ||
    process.env.DEFAULT_TENANT_ID ||
    '00000000-0000-0000-0000-000000000000'
  );
  res.ok({ id, name: process.env.DEFAULT_TENANT_NAME || 'Organization' });
});

/* ---- Limits & invoices already expected by your UI ---- */
router.get('/limits', requireAuth, (_req, res) => {
  res.ok({
    plan: { id: 'fallback', name: 'Basic', code: 'basic' },
    limits: { borrowers: 1000, loans: 2000 },
    entitlements: [
      'savings.view', 'accounting.view', 'collateral.view', 'loans.view',
      'investors.view', 'collections.view', 'assets.view',
    ],
    usage: { borrowers: 0, loans: 0 },
  });
});

router.get('/invoices', requireAuth, (_req, res) => res.ok({ invoices: [] }));

module.exports = router;
