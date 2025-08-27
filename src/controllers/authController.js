'use strict';

const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const speakeasy = require('speakeasy');
const { sequelize, Setting } = require('../models');
const { QueryTypes } = require('sequelize');
require('dotenv').config();

const JWT_SECRET = process.env.JWT_SECRET;

/* ------------------------------ helpers ------------------------------ */

function sanitizeKeyPart(s) {
  // allow only [A-Za-z0-9._-] to satisfy Setting.key regex
  return String(s || '').replace(/[^A-Za-z0-9._-]/g, '.');
}
function twoFaKeyForUser(userId) {
  return `user.${sanitizeKeyPart(userId)}.2fa`;
}
function getActorId(req) {
  if (req.user?.id) return req.user.id;
  // fallback: try bearer token so routes can work even if auth middleware was not added
  try {
    const auth = req.headers.authorization || '';
    const m = auth.match(/^Bearer\s+(.+)$/i);
    if (m && JWT_SECRET) {
      const payload = jwt.verify(m[1], JWT_SECRET);
      return payload.userId || payload.id || null;
    }
  } catch { /* ignore */ }
  return null;
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
       WHERE email = :email
       LIMIT 1`,
      {
        replacements: { email },
        type: QueryTypes.SELECT
      }
    );

    const user = rows && rows[0];

    if (!user) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    const isMatch = await bcrypt.compare(String(password), String(user.password_hash || ''));
    if (!isMatch) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    const token = jwt.sign(
      { userId: user.id, email: user.email, role: user.role },
      JWT_SECRET,
      { expiresIn: '2h' }
    );

    return res.status(200).json({
      message: 'Login successful',
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    return res.status(500).json({ message: 'Server error' });
  }
};

/* ------------------------------ 2FA ------------------------------ */
/**
 * We store a per-user JSON blob at Setting.key = `user.<USERID>.2fa`
 * Shape: { enabled: boolean, secret: base32string }
 */

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

    // Save as disabled until verified
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
      // already off
      await Setting.set(key, { enabled: false }, userId, userId);
      return res.json({ ok: true, enabled: false });
    }

    // For safety, require a valid current code to turn off
    const ok = token
      ? speakeasy.totp.verify({
          secret: value.secret,
          encoding: 'base32',
          token: String(token),
          window: 1,
        })
      : false;

    if (!ok) return res.status(400).json({ message: 'A valid code is required to disable 2FA' });

    // Clear secret (or keep it if you prefer re-enable without setup)
    await Setting.set(key, { enabled: false }, userId, userId);
    return res.json({ ok: true, enabled: false });
  } catch (err) {
    console.error('2FA disable error:', err);
    return res.status(500).json({ message: 'Failed to disable 2FA' });
  }
};
