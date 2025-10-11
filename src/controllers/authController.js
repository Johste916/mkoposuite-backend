'use strict';

const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const speakeasy = require('speakeasy');
const crypto = require('crypto');
let sequelize, Setting, QueryTypes;
try {
  ({ sequelize, Setting } = require('../models'));
  ({ QueryTypes } = require('sequelize'));
} catch { /* models may be unavailable; handled below */ }

require('dotenv').config();

/* ─────────────────────────── Env / constants ─────────────────────────── */
const NODE_ENV = process.env.NODE_ENV || 'development';
/* Always define JWT_SECRET to avoid ReferenceError. In prod, we refuse to run with the fallback. */
const JWT_SECRET =
  process.env.JWT_SECRET ||
  process.env.JWT_KEY ||
  'DEV_ONLY_FALLBACK_SECRET_change_me';

const DEFAULT_TENANT_ID =
  process.env.DEFAULT_TENANT_ID || '00000000-0000-0000-0000-000000000000';

/* ───────────────────────────── Helpers ───────────────────────────── */
function sanitizeKeyPart(s) {
  return String(s || '').replace(/[^A-Za-z0-9._-]/g, '.');
}
function twoFaKeyForUser(userId) {
  return `user.${sanitizeKeyPart(userId)}.2fa`;
}
function getActorId(req) {
  if (req.user?.id) return req.user.id;
  try {
    const auth = req.headers.authorization || '';
    const m = auth.match(/^Bearer\s+(.+)$/i);
    if (m && JWT_SECRET) {
      const payload = jwt.verify(m[1], JWT_SECRET);
      return payload.userId || payload.id || null;
    }
  } catch {}
  return null;
}

/** Legacy scrypt format: s2$<saltB64/Url>$<hashB64/Url> */
function isScryptHash(str) {
  return typeof str === 'string' && str.startsWith('s2$') && str.split('$').length === 3;
}
function decodeFlexibleB64(s) {
  try { return Buffer.from(String(s), 'base64url'); } catch {}
  try { return Buffer.from(String(s), 'base64'); } catch {}
  return null;
}
function verifyScryptHash(hashed, password) {
  try {
    const [, saltB64, hashB64] = String(hashed).split('$');
    const saltBuf = decodeFlexibleB64(saltB64);
    const hashBuf = decodeFlexibleB64(hashB64);
    if (!saltBuf || !hashBuf) return false;
    const calc = crypto.scryptSync(String(password), saltBuf, hashBuf.length);
    return crypto.timingSafeEqual(calc, hashBuf);
  } catch {
    return false;
  }
}

/** Grab whichever password field exists on the row */
function extractStoredHash(u) {
  return (
    u.password_hash ||
    u.passwordHash ||
    u.password_digest ||
    u.passwordDigest ||
    u.password || // some envs
    null
  );
}

/** Find tenantId for a user via common layouts, fallback to DEFAULT_TENANT_ID */
async function findTenantIdForUser(userId) {
  if (!sequelize) return DEFAULT_TENANT_ID;
  const uid = String(userId);

  // 1) CamelCase join table
  try {
    const rows = await sequelize.query(
      `SELECT "tenantId" AS "tenantId"
         FROM "TenantUsers"
        WHERE "userId" = :uid
        ORDER BY "createdAt" NULLS LAST
        LIMIT 1`,
      { replacements: { uid }, type: QueryTypes.SELECT }
    );
    if (rows?.[0]?.tenantId) return rows[0].tenantId;
  } catch {}

  // 2) snake_case join table
  try {
    const rows = await sequelize.query(
      `SELECT tenant_id AS "tenantId"
         FROM tenant_users
        WHERE user_id = :uid
        ORDER BY created_at NULLS LAST
        LIMIT 1`,
      { replacements: { uid }, type: QueryTypes.SELECT }
    );
    if (rows?.[0]?.tenantId) return rows[0].tenantId;
  } catch {}

  // 3) Users.tenantId column
  try {
    const rows = await sequelize.query(
      `SELECT "tenantId" AS "tenantId"
         FROM "Users"
        WHERE id = :uid
        LIMIT 1`,
      { replacements: { uid }, type: QueryTypes.SELECT }
    );
    if (rows?.[0]?.tenantId) return rows[0].tenantId;
  } catch {}

  return DEFAULT_TENANT_ID;
}

/* ───────────────────────────── LOGIN ───────────────────────────── */
exports.login = async (req, res) => {
  const { email, password } = req.body || {};

  if (!email || !password) {
    return res.status(400).json({ message: 'Email and password are required' });
  }

  // If running in production with the fallback secret, refuse to proceed.
  if ((!process.env.JWT_SECRET && NODE_ENV === 'production') || !JWT_SECRET) {
    return res.status(500).json({ message: 'Server misconfigured (missing JWT secret)' });
  }

  if (!sequelize || !QueryTypes) {
    // Without models/DB, new signups won’t persist → they cannot log in later.
    return res.status(500).json({
      message:
        'Database not available. Ensure models are loaded and DB is connected (NODE_ENV=production with DATABASE_URL/SSL for Supabase).',
    });
  }

  try {
    // SELECT * to tolerate column differences across environments
    const rows = await sequelize.query(
      `SELECT *
         FROM "Users"
        WHERE LOWER(email) = LOWER(:email)
        LIMIT 1`,
      { replacements: { email }, type: QueryTypes.SELECT }
    );

    const user = rows && rows[0];
    if (!user) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    const stored = extractStoredHash(user);
    let ok = false;

    if (stored) {
      if (isScryptHash(stored)) ok = verifyScryptHash(stored, password);
      else ok = await bcrypt.compare(String(password), String(stored));
    }

    if (!ok) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    const tenantId = await findTenantIdForUser(user.id);

    const token = jwt.sign(
      { userId: user.id, email: user.email, role: user.role, tenantId },
      JWT_SECRET,
      { expiresIn: '2h' }
    );

    return res.status(200).json({
      message: 'Login successful',
      token,
      tenantId,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        tenantId,
      },
    });
  } catch (error) {
    console.error('Login error:', error);
    const pg = error?.original?.code || error?.parent?.code;
    if (pg === '42P01') {
      return res.status(500).json({
        message:
          'Users table missing. Run DB migrations (e.g. `npx sequelize-cli db:migrate`).',
      });
    }
    if (pg === '42703') {
      return res.status(500).json({
        message:
          'A required column is missing on Users. Ensure migrations are up to date.',
      });
    }
    return res.status(500).json({ message: 'Server error' });
  }
};

/* ───────────────────────────── 2FA ───────────────────────────── */
exports.getTwoFAStatus = async (req, res) => {
  try {
    const userId = getActorId(req);
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });

    if (!Setting?.get) return res.json({ enabled: false });

    const key = twoFaKeyForUser(userId);
    const value = await Setting.get(key, { enabled: false });
    return res.json({ enabled: !!value.enabled });
  } catch (err) {
    console.error('2FA status error:', err);
    return res.status(500).json({ message: 'Failed to load 2FA status' });
  }
};

exports.setupTwoFA = async (req, res) => {
  try {
    const userId = getActorId(req);
    const email = req.user?.email || '';
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });
    if (!Setting?.set) return res.status(500).json({ message: 'Settings store unavailable' });

    const secret = speakeasy.generateSecret({
      length: 20,
      name: `MkopoSuite (${email || userId})`,
    });

    const key = twoFaKeyForUser(userId);
    await Setting.set(key, { enabled: false, secret: secret.base32 }, userId, userId);

    return res.json({ secret: secret.base32, otpauthUrl: secret.otpauth_url });
  } catch (err) {
    console.error('2FA setup error:', err);
    return res.status(500).json({ message: 'Failed to start 2FA setup' });
  }
};

exports.verifyTwoFA = async (req, res) => {
  try {
    const userId = getActorId(req);
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });
    if (!Setting?.get || !Setting?.set) return res.status(500).json({ message: 'Settings store unavailable' });

    const { token } = req.body || {};
    if (!token) return res.status(400).json({ message: 'Token is required' });

    const key = twoFaKeyForUser(userId);
    const value = await Setting.get(key, null);
    if (!value?.secret) {
      return res.status(400).json({ message: '2FA not in setup state' });
    }

    const ok = speakeasy.totp.verify({
      secret: value.secret,
      encoding: 'base32',
      token: String(token),
      window: 1,
    });

    if (!ok) return res.status(400).json({ message: 'Invalid code' });

    await Setting.set(key, { enabled: true, secret: value.secret }, userId, userId);
    return res.json({ ok: true, enabled: true });
  } catch (err) {
    console.error('2FA verify error:', err);
    return res.status(500).json({ message: 'Failed to verify 2FA' });
  }
};

exports.disableTwoFA = async (req, res) => {
  try {
    const userId = getActorId(req);
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });
    if (!Setting?.get || !Setting?.set) return res.status(500).json({ message: 'Settings store unavailable' });

    const { token } = req.body || {};
    const key = twoFaKeyForUser(userId);
    const value = await Setting.get(key, null);

    if (!value?.secret) {
      await Setting.set(key, { enabled: false }, userId, userId);
      return res.json({ ok: true, enabled: false });
    }

    const ok = token
      ? speakeasy.totp.verify({
          secret: value.secret,
          encoding: 'base32',
          token: String(token),
          window: 1,
        })
      : false;

    if (!ok) return res.status(400).json({ message: 'A valid code is required to disable 2FA' });

    await Setting.set(key, { enabled: false }, userId, userId);
    return res.json({ ok: true, enabled: false });
  } catch (err) {
    console.error('2FA disable error:', err);
    return res.status(500).json({ message: 'Failed to disable 2FA' });
  }
};
// backend/src/controllers/authController.js (example)
const { logAudit } = require('../utils/audit');

exports.login = async (req, res) => {
  const { email } = req.body;
  try {
    // ... do auth
    await logAudit({ req, category: 'auth', action: 'login:success', entity:'User', entityId: user.id, message: `Login OK for ${email}` });
    res.json({ token });
  } catch (e) {
    await logAudit({ req, category: 'auth', action: 'login:failed', message: `Login failed for ${email}` });
    res.status(401).json({ error:'Invalid credentials' });
  }
};
