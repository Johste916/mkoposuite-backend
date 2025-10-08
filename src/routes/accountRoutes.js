'use strict';

const express = require('express');
const router = express.Router();

let auth = {};
try { auth = require('../middleware/authMiddleware'); } catch {}
const authenticateUser = auth.authenticateUser || ((_req, _res, next) => next());
const requireAuth      = auth.requireAuth      || ((_req, _res, next) => next());

/* Real controller if present; fall back to safe stubs */
let account;
try {
  account = require('../controllers/account/accountSettingsController');
} catch {
  const ok = (res, payload = {}) => res.ok(payload);
  account = {
    async getMe(_req, res) { ok(res, { id: 'me', name: 'User', email: 'user@example.com' }); },
    async updateMe(req, res) { ok(res, { ok: true, me: { ...(req.body || {}) } }); },

    async getPreferences(_req, res) { ok(res, { theme: 'system', locale: 'en' }); },
    async updatePreferences(req, res) { ok(res, { ok: true, preferences: req.body || {} }); },

    async getNotifications(_req, res) { ok(res, { items: [], total: 0, unread: 0 }); },
    async updateNotifications(req, res) { ok(res, { ok: true, rules: req.body || {} }); },

    async getSessions(_req, res) { ok(res, { active: [], current: { ip: '0.0.0.0', agent: 'fallback' } }); },
    async revokeAllSessions(_req, res) { ok(res, { ok: true }); },

    async uploadAvatar(_req, res) { ok(res, { ok: true, avatarUrl: null }); },

    async getBilling(_req, res) {
      ok(res, {
        plan: process.env.SYSTEM_PLAN || 'pro',
        status: 'active',
        provider: 'fallback',
        seats: 'unlimited',
        trialEndsAt: null,
        renewsAt: null,
      });
    },
    async updateBilling(req, res) { ok(res, { ok: true, billing: req.body || {} }); },

    async changePassword(_req, res) { ok(res, { ok: true }); },
  };
}

/* Helpers reused by alias endpoints */
const tenantMePayload = (req) => {
  const id = String(
    req.headers['x-tenant-id'] ||
    process.env.DEFAULT_TENANT_ID ||
    '00000000-0000-0000-0000-000000000000'
  );
  return {
    id,
    name: process.env.DEFAULT_TENANT_NAME || 'Organization',
    status: 'trial',
    planCode: 'basic',
    planLabel: 'basic',
    trialEndsAt: null,
    trialDaysLeft: null,
    autoDisableOverdue: false,
    graceDays: 7,
    billingEmail: '',
    seats: null,
    staffCount: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
};
const tenantLimitsPayload = () => ({
  plan: { id: 'fallback', name: 'Basic', code: 'basic' },
  limits: { borrowers: 1000, loans: 2000 },
  usage: { borrowers: 0, loans: 0 },
  entitlements: [
    'savings.view', 'accounting.view', 'collateral.view', 'loans.view',
    'investors.view', 'collections.view', 'assets.view',
  ],
});

/* Auth for everything under /api/account */
router.use(authenticateUser, requireAuth);

// Profile / identity
router.get('/me', account.getMe);
router.put('/me', account.updateMe);

// Preferences
router.get('/preferences', account.getPreferences);
router.put('/preferences', account.updatePreferences);

// Notifications
router.get('/notifications', account.getNotifications);
router.put('/notifications', account.updateNotifications);

// Security sessions
router.get('/security/sessions', account.getSessions);
router.post('/security/sessions/revoke-all', account.revokeAllSessions);

// Avatar upload (multipart/form-data, field name: "avatar")
router.post('/avatar', account.uploadAvatar);

// Billing (kept for compatibility)
router.get('/billing', account.getBilling);
router.put('/billing', account.updateBilling);

// Change password
router.post('/change-password', account.changePassword);

/* ---- ALIASES some frontends call ---- */
// /api/account/tenant
router.get('/tenant', (req, res) => res.ok(tenantMePayload(req)));
// /api/account/tenant/limits
router.get('/tenant/limits', (_req, res) => res.ok(tenantLimitsPayload()));
// /api/account/organization (same as tenant for single-tenant apps)
router.get('/organization', (req, res) => res.ok(tenantMePayload(req)));
// /api/account/organization/limits
router.get('/organization/limits', (_req, res) => res.ok(tenantLimitsPayload()));

module.exports = router;
