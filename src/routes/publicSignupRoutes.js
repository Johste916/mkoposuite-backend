'use strict';

const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
let jwt; try { jwt = require('jsonwebtoken'); } catch {}

const router = express.Router();

/* ───────────────────────────── Config from env ───────────────────────────── */
const SELF_SIGNUP_ENABLED =
  String(process.env.SELF_SIGNUP_ENABLED || '1').toLowerCase() === '1' ||
  String(process.env.SELF_SIGNUP_ENABLED || 'true').toLowerCase() === 'true';

const DEFAULT_TRIAL_DAYS = Number.isFinite(Number(process.env.DEFAULT_TRIAL_DAYS))
  ? Number(process.env.DEFAULT_TRIAL_DAYS)
  : 14;

const REQUIRE_EMAIL_VERIFICATION =
  String(process.env.REQUIRE_EMAIL_VERIFICATION || '0').toLowerCase() === '1' ||
  String(process.env.REQUIRE_EMAIL_VERIFICATION || 'false').toLowerCase() === 'true';

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';
const JWT_SECRET = process.env.JWT_SECRET || null;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

/* ───────────────────────────── Utilities / helpers ───────────────────────── */
function ok(res, data, extra = {}) {
  if (res.ok) return res.ok(data, extra);
  if (typeof extra.total === 'number') res.setHeader('X-Total-Count', String(extra.total));
  return res.json(data);
}
function fail(res, code, message, extra = {}) {
  if (res.fail) return res.fail(code, message, extra);
  return res.status(code).json({ error: message, ...extra });
}
const normalizeEmail = (e) => String(e || '').trim().toLowerCase();
const validEmail = (e) => {
  const s = normalizeEmail(e);
  return !!s && s.includes('@') && s.includes('.') && s.length <= 254;
};
const validPassword = (p) => typeof p === 'string' && p.length >= 8;

function hashPassword(password) {
  const rounds = Number(process.env.BCRYPT_ROUNDS || 10);
  return bcrypt.hashSync(String(password), rounds);
}
function trialEndsAt(days) {
  return new Date(Date.now() + Math.max(0, days) * 86400000);
}

/* ─────────────────────── Force real models when present ──────────────────── */
function getModels(req) {
  // Prefer the app-attached models (set in app.js)…
  let m = req.app.get('models');
  // …but also try a direct require as a safety net.
  if (!m) {
    try { m = require('../models'); } catch (e) { /* ignore */ }
    try { m = m || require('../../models'); } catch (e) { /* ignore */ }
  }
  return m || null;
}

/* ───────────────────────────── Local memory fallback ─────────────────────── */
const MEM = {
  tenants: new Map(), users: new Map(), tenantUsers: new Map()
};
function memCreateTenantAndOwner({ companyName, email, password, adminName, phone, planCode }) {
  const tenantId = crypto.randomUUID?.() || String(Date.now()) + '-t';
  const userId   = crypto.randomUUID?.() || String(Date.now()) + '-u';
  const nowIso = new Date().toISOString();

  const t = {
    id: tenantId,
    name: companyName,
    status: 'trial',
    plan_code: (planCode || 'basic').toLowerCase(),
    billing_email: email,
    trial_ends_at: trialEndsAt(DEFAULT_TRIAL_DAYS).toISOString().slice(0, 10),
    seats: null,
    created_at: nowIso, updated_at: nowIso,
  };
  MEM.tenants.set(tenantId, t);

  const u = {
    id: userId,
    name: adminName || email.split('@')[0],
    email, phone: phone || null,
    password_hash: hashPassword(password), // bcrypt
    role: 'owner',
    created_at: nowIso, updated_at: nowIso,
  };
  MEM.users.set(userId, u);
  MEM.tenantUsers.set(`${tenantId}:${userId}`, 'owner');

  return { tenantId, userId, tenant: t, user: u };
}

/* ───────────────────────────── Route: status (public) ────────────────────── */
router.get('/status', (req, res) => {
  return ok(res, {
    enabled: !!SELF_SIGNUP_ENABLED,
    requireEmailVerification: !!REQUIRE_EMAIL_VERIFICATION,
    defaultTrialDays: DEFAULT_TRIAL_DAYS,
  });
});

/* ───────────────────────────── Route: POST / (signup) ────────────────────── */
router.post('/', async (req, res) => {
  if (!SELF_SIGNUP_ENABLED) return fail(res, 403, 'Self-service signup is disabled.');

  const b = req.body || {};
  const companyName = String(b.companyName || '').trim();
  const email = normalizeEmail(b.email);
  const password = b.password;
  const adminName = typeof b.adminName === 'string' ? b.adminName.trim() : '';
  const phone = typeof b.phone === 'string' ? b.phone.trim() : '';
  const planCode = typeof b.planCode === 'string' ? b.planCode.trim().toLowerCase() : 'basic';

  if (!companyName || companyName.length < 2) return fail(res, 400, 'companyName is required.');
  if (!validEmail(email)) return fail(res, 400, 'Valid email is required.');
  if (!validPassword(password)) return fail(res, 400, 'Password must be at least 8 characters.');

  const models = getModels(req);
  const haveTenant = !!(models?.Tenant?.create);
  const haveUser   = !!(models?.User?.create);

  try {
    if (haveTenant && haveUser && models.sequelize?.transaction) {
      const out = await models.sequelize.transaction(async (t) => {
        // Enforce case-insensitive unique email before create
        const existing = await models.User.findOne({ where: models.sequelize.where(
          models.sequelize.fn('LOWER', models.sequelize.col('email')), email
        )}, { transaction: t }).catch(() => null);
        if (existing) throw Object.assign(new Error('dup'), { __dup: true });

        const tenant = await models.Tenant.create({
          name: companyName,
          status: 'trial',
          plan_code: planCode,
          trial_ends_at: trialEndsAt(DEFAULT_TRIAL_DAYS),
          billing_email: email,
          seats: null,
        }, { transaction: t });

        const user = await models.User.create({
          name: adminName || companyName + ' Admin',
          email,
          phone: phone || null,
          password_hash: hashPassword(password), // bcrypt (TEXT column)
          role: 'owner',
          tenantId: tenant.id,     // ok if column exists; ignored otherwise
          is_active: true,         // ok if column exists
          status: 'active',        // ok if column exists
        }, { transaction: t });

        if (models.TenantUser?.create) {
          await models.TenantUser.create({ tenantId: tenant.id, userId: user.id, role: 'owner' }, { transaction: t });
        } else {
          // best-effort raw insert if the join table exists
          try {
            await models.sequelize.query(
              `INSERT INTO tenant_users (tenant_id, user_id, role)
               VALUES (:tenantId, :userId, 'owner') ON CONFLICT DO NOTHING`,
              { replacements: { tenantId: tenant.id, userId: user.id }, transaction: t }
            );
          } catch {}
        }

        if (models.Branch?.create) {
          await models.Branch.create({ tenantId: tenant.id, name: 'Head Office', code: 'HO' }, { transaction: t })
            .catch(() => null);
        }

        return { tenant, user };
      });

      // optional email verification token
      let verification = null;
      if (REQUIRE_EMAIL_VERIFICATION) {
        verification = Buffer.from(JSON.stringify({ email, t: Date.now() })).toString('base64url');
      }

      // optional immediate token (skip if verification required)
      let token = null;
      if (jwt && JWT_SECRET && !REQUIRE_EMAIL_VERIFICATION) {
        token = jwt.sign({ sub: out.user.id, tenantId: out.tenant.id }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
      }

      return ok(res, {
        ok: true,
        mode: 'db',
        tenantId: out.tenant.id,
        userId: out.user.id,
        planCode,
        trialEndsAt: out.tenant.trial_ends_at,
        requireEmailVerification: !!REQUIRE_EMAIL_VERIFICATION,
        verificationToken: REQUIRE_EMAIL_VERIFICATION ? verification : undefined,
        token: token || undefined,
        next: { loginUrl: `${FRONTEND_URL}/login?email=${encodeURIComponent(email)}` },
      });
    }

    // ❗ If we got here we don’t have models → use memory fallback (warn loudly)
    console.warn('[SIGNUP] Using MEMORY fallback (models not available). New users will NOT persist.');
    const r = memCreateTenantAndOwner({ companyName, email, password, adminName, phone, planCode });

    let token = null;
    if (jwt && JWT_SECRET && !REQUIRE_EMAIL_VERIFICATION) {
      token = jwt.sign({ sub: r.userId, tenantId: r.tenantId }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
    }

    return ok(res, {
      ok: true,
      mode: 'memory',
      tenantId: r.tenantId,
      userId: r.userId,
      planCode,
      trialEndsAt: r.tenant.trial_ends_at,
      requireEmailVerification: !!REQUIRE_EMAIL_VERIFICATION,
      token: token || undefined,
      next: { loginUrl: `${FRONTEND_URL}/login?email=${encodeURIComponent(email)}` },
    });
  } catch (e) {
    if (e?.__dup) return fail(res, 409, 'An account with that email already exists.');
    const pgCode = e?.original?.code || e?.parent?.code;
    if (pgCode === '23505') return fail(res, 409, 'A record already exists with those details.');
    return fail(res, 500, e.message || 'Failed to create tenant.');
  }
});

/* ─────────────────────────── Route: POST /verify-email ───────────────────── */
router.post('/verify-email', (req, res) => {
  if (!REQUIRE_EMAIL_VERIFICATION) return ok(res, { ok: true, message: 'Email verification not required.' });
  const token = String(req.body?.token || '');
  if (!token) return fail(res, 400, 'token is required');
  try {
    const decoded = JSON.parse(Buffer.from(token, 'base64url').toString('utf8'));
    if (!decoded?.email) return fail(res, 400, 'Invalid token');
    return ok(res, { ok: true, verified: true, email: decoded.email });
  } catch {
    return fail(res, 400, 'Invalid token');
  }
});

module.exports = router;
