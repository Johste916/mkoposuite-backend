// server/routes/publicSignupRoutes.js
'use strict';

const express = require('express');
const crypto = require('crypto');
let jwt;      try { jwt = require('jsonwebtoken'); } catch {}
let bcrypt;   try { bcrypt = require('bcryptjs'); } catch {}

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

const FRONTEND_URL   = process.env.FRONTEND_URL || 'http://localhost:5173';
const JWT_SECRET     = process.env.JWT_SECRET || null;
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
function normalizeEmail(e) {
  return String(e || '').trim().toLowerCase();
}
function validEmail(e) {
  const s = normalizeEmail(e);
  return !!s && s.includes('@') && s.includes('.') && s.length <= 254;
}
function validPassword(p) {
  return typeof p === 'string' && p.length >= 8;
}
function trialEndsAt(days) {
  const d = new Date(Date.now() + Math.max(0, days) * 86400000);
  return d; // Sequelize DATE
}

/** scrypt (legacy fallback) -> returns string like: s2$<salt>$<hash> */
function scryptHash(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(password), salt, 64);
  return `s2$${salt.toString('base64url')}$${hash.toString('base64url')}`;
}

/** Prefer bcrypt for DB (matches login controller); fallback to scrypt if bcrypt missing */
function hashPasswordSync(password) {
  if (bcrypt?.hashSync) return bcrypt.hashSync(String(password), 10);
  return scryptHash(password);
}
async function hashPassword(password) {
  if (bcrypt?.hash) return await bcrypt.hash(String(password), 10);
  // async-compatible fallback
  return scryptHash(password);
}

/* ───────────────────────────── Local memory fallback ─────────────────────── */
const MEM = {
  tenants: new Map(),   // id -> { ... }
  users: new Map(),     // id -> { ... }
  tenantUsers: new Map()// `${tenantId}:${userId}` -> role
};

function memCreateTenantAndOwner({ companyName, email, password, adminName, phone, planCode }) {
  const tenantId = crypto.randomUUID?.() || String(Date.now()) + '-t';
  const userId   = crypto.randomUUID?.() || String(Date.now()) + '-u';
  const now = new Date().toISOString();

  const t = {
    id: tenantId,
    name: companyName,
    status: 'trial',
    plan_code: (planCode || 'basic').toLowerCase(),
    billing_email: email,
    trial_ends_at: trialEndsAt(DEFAULT_TRIAL_DAYS).toISOString().slice(0, 10),
    seats: null,
    created_at: now,
    updated_at: now,
  };
  MEM.tenants.set(tenantId, t);

  const u = {
    id: userId,
    name: adminName || email.split('@')[0],
    email,
    phone: phone || null,
    // Use bcrypt if available so even memory users match login semantics
    password_hash: hashPasswordSync(password),
    created_at: now,
    updated_at: now,
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

/* ───────────────────────────── Route: POST / (public signup) ─────────────── */
/**
 * Body:
 * {
 *   companyName: string (required)
 *   email: string (required, admin login)
 *   password: string (required, min 8)
 *   adminName?: string
 *   phone?: string
 *   planCode?: 'basic' | 'pro' | string
 * }
 */
router.post('/', async (req, res) => {
  if (!SELF_SIGNUP_ENABLED) {
    return fail(res, 403, 'Self-service signup is disabled.');
  }

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

  const models = req.app.get('models');
  const haveTenant = !!(models && models.Tenant && typeof models.Tenant.create === 'function');
  const haveUser   = !!(models && models.User   && typeof models.User.create   === 'function');

  // Email uniqueness
  if (haveUser) {
    const existing = await models.User.findOne({ where: { email } }).catch(() => null);
    if (existing) return fail(res, 409, 'An account with that email already exists.');
  } else {
    for (const u of MEM.users.values()) {
      if (u.email === email) return fail(res, 409, 'An account with that email already exists.');
    }
  }

  // Create records
  try {
    if (haveTenant && haveUser && models.sequelize?.transaction) {
      const out = await models.sequelize.transaction(async (t) => {
        // Tenant
        const tenant = await models.Tenant.create({
          name: companyName,
          status: 'trial',
          plan_code: planCode,
          trial_ends_at: trialEndsAt(DEFAULT_TRIAL_DAYS),
          billing_email: email,
          seats: null,
        }, { transaction: t });

        // Hash with bcrypt (preferred) so login controller's bcrypt.compare works
        const passHash = await hashPassword(password);

        // User (owner)
        const userPayload = {
          name: adminName || companyName + ' Admin',
          email,
          phone: phone || null,
          password_hash: passHash,
        };

        // If a legacy 'password' column exists on the model, populate it (hashed) to satisfy NOT NULL
        const hasLegacyPassword =
          !!(models.User?.rawAttributes && models.User.rawAttributes.password);
        if (hasLegacyPassword) userPayload.password = passHash;

        const user = await models.User.create(userPayload, { transaction: t });

        // Link (TenantUser) if model exists
        if (models.TenantUser?.create) {
          await models.TenantUser.create({
            tenantId: tenant.id,
            userId: user.id,
            role: 'owner',
          }, { transaction: t });
        }

        // Optional: create a default branch if your schema has Branch
        if (models.Branch?.create) {
          await models.Branch.create({
            tenantId: tenant.id,
            name: 'Head Office',
            code: 'HO',
          }, { transaction: t }).catch(() => null);
        }

        return { tenant, user };
      });

      // Email verification (optional)
      let verification = null;
      if (REQUIRE_EMAIL_VERIFICATION) {
        verification = Buffer.from(JSON.stringify({ email, t: Date.now() }))
          .toString('base64url');
      }

      // JWT for immediate entry (if verification not required)
      let token = null;
      if (jwt && JWT_SECRET && !REQUIRE_EMAIL_VERIFICATION) {
        token = jwt.sign(
          { sub: out.user.id, tenantId: out.tenant.id },
          JWT_SECRET,
          { expiresIn: JWT_EXPIRES_IN }
        );
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
        next: {
          loginUrl: `${FRONTEND_URL}/login?email=${encodeURIComponent(email)}`
        }
      });
    }

    // Memory fallback (also uses bcrypt if available)
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
      next: { loginUrl: `${FRONTEND_URL}/login?email=${encodeURIComponent(email)}` }
    });
  } catch (e) {
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
    // In a real impl. you would mark the user as verified here.
    return ok(res, { ok: true, verified: true, email: decoded.email });
  } catch {
    return fail(res, 400, 'Invalid token');
  }
});

module.exports = router;
