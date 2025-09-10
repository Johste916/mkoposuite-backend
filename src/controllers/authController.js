'use strict';

const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const speakeasy = require('speakeasy');
const crypto = require('crypto');
const { sequelize, Setting } = require('../models');
const { QueryTypes } = require('sequelize');
require('dotenv').config();

const JWT_SECRET = process.env.JWT_SECRET;
const DEFAULT_TENANT_ID =
  process.env.DEFAULT_TENANT_ID || '00000000-0000-0000-0000-000000000000';

/* ------------------------------ helpers ------------------------------ */

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

/** Legacy scrypt format: s2$<saltB64OrUrl>$<hashB64OrUrl> */
function isScryptHash(str) {
  return typeof str === 'string' && str.startsWith('s2$') && str.split('$').length === 3;
}
function decodeFlexibleB64(s) {
  // try base64url then base64
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

/** Find a tenant for the user (first match), tolerant to snake/camel tables */
async function findTenantIdForUser(userId) {
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
  // 3) sometimes tenantId is on Users
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
  // 4) final fallback: env default
  return DEFAULT_TENANT_ID;
}

/* ------------------------------ LOGIN ------------------------------ */

exports.login = async (req, res) => {
  const { email, password } = req.body || {};

  if (!email || !password) {
    return res.status(400).json({ message: 'Email and password are required' });
  }
  if (!JWT_SECRET) {
    return res.status(500).json({ message: 'Server misconfigured (missing JWT secret)' });
  }

  try {
    const rows = await sequelize.query(
      `SELECT id, name, email, role, password_hash
       FROM "Users"
       WHERE LOWER(email) = LOWER(:email)
       LIMIT 1`,
      {
        replacements: { email },
        type: QueryTypes.SELECT
      }
    );

    const user = rows && rows[0];
    const authFail = () => res.status(401).json({ message: 'Invalid email or password' });
    if (!user) return authFail();

    const stored = String(user.password_hash || '');
    let isMatch = false;

    if (stored) {
      if (isScryptHash(stored)) {
        isMatch = verifyScryptHash(stored, password);
      } else {
        isMatch = await bcrypt.compare(String(password), stored);
      }
    }
    if (!isMatch) return authFail();

    // Resolve tenantId for brand-new users
    const tenantId = await findTenantIdForUser(user.id);

    const token = jwt.sign(
      { userId: user.id, email: user.email, role: user.role, tenantId },
      JWT_SECRET,
      { expiresIn: '2h' }
    );

    return res.status(200).json({
      message: 'Login successful',
      token,
      tenantId, // <— help frontend seed x-tenant-id
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        tenantId, // <— also include on user object for your existing codepaths
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    const pgCode = error?.original?.code || error?.parent?.code;
    if (pgCode === '42P01') {
      return res.status(500).json({
        message: 'Users table missing. Run DB migrations (e.g. `npx sequelize-cli db:migrate`).'
      });
    }
    if (pgCode === '42703') {
      return res.status(500).json({
        message: 'A required column is missing on Users. Ensure migrations are up to date.'
      });
    }
    return res.status(500).json({ message: 'Server error' });
  }
};

/* ------------------------------ 2FA ------------------------------ */

exports.getTwoFAStatus = async (req, res) => {
  try {
    const userId = getActorId(req);
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });

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

    const secret = speakeasy.generateSecret({
      length: 20,
      name: `MkopoSuite (${email || userId})`,
    });

    const key = twoFaKeyForUser(userId);

    await Setting.set(
      key,
      { enabled: false, secret: secret.base32 },
      userId,
      userId
    );

    return res.json({
      secret: secret.base32,
      otpauthUrl: secret.otpauth_url
    });
  } catch (err) {
    console.error('2FA setup error:', err);
    return res.status(500).json({ message: 'Failed to start 2FA setup' });
  }
};

exports.verifyTwoFA = async (req, res) => {
  try {
    const userId = getActorId(req);
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });

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
