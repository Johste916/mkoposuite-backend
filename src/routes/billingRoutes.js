'use strict';

const express = require('express');
const router = express.Router();
const { authenticateUser, requireAuth, authorizeRoles } = require('../middleware/authMiddleware');

function getModels(req) {
  return req.app?.get('models') || (function tryRequire() {
    try { return require('../models'); } catch { try { return require('../../models'); } catch { return null; } }
  }());
}
function getModel(models, name) {
  return models?.[name] || models?.sequelize?.models?.[name] || null;
}

const ADMIN_ONLY = authorizeRoles('admin', 'director');
const ANY_AUTH   = requireAuth;

/**
 * GET /api/billing
 * Returns subscription summary for current tenant (if available) or a safe default.
 */
router.get('/', authenticateUser, ANY_AUTH, async (req, res, next) => {
  try {
    const models = getModels(req);
    const Subscription = getModel(models, 'BillingSubscription');
    const tenantId = req.context?.tenantId || req.user?.tenantId || null;

    if (Subscription && tenantId) {
      const sub = await Subscription.findOne({ where: { tenantId } });
      if (sub) {
        return res.json({
          plan: sub.plan || 'free',
          status: sub.status || 'active',
          currency: sub.currency || 'USD',
          seats: sub.seats || 1,
          renewsAt: sub.renewsAt || null,
        });
      }
    }

    // default fallback
    return res.json({ plan: 'free', status: 'active', currency: 'USD', seats: 1, renewsAt: null });
  } catch (e) { next(e); }
});

/**
 * GET /api/billing/invoices
 */
router.get('/invoices', authenticateUser, ANY_AUTH, async (req, res, next) => {
  try {
    const models = getModels(req);
    const Invoice = getModel(models, 'Invoice');
    const tenantId = req.context?.tenantId || req.user?.tenantId || null;

    if (Invoice && tenantId) {
      const rows = await Invoice.findAll({
        where: { tenantId },
        order: [['issuedAt', 'DESC']],
        limit: 200,
      });
      res.setHeader('X-Total-Count', String(rows.length));
      return res.json(rows);
    }

    // default: no invoices yet
    res.setHeader('X-Total-Count', '0');
    return res.json([]);
  } catch (e) { next(e); }
});

/**
 * POST /api/billing/portal
 * Return a URL to your billing portal (Stripe, Paddle, etc.). Admin only.
 */
router.post('/portal', authenticateUser, ADMIN_ONLY, async (_req, res) => {
  // Replace with your provider logic
  return res.json({ url: process.env.BILLING_PORTAL_URL || 'https://billing.example.com/portal' });
});

module.exports = router;
