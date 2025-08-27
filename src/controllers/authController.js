'use strict';

const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { sequelize, Setting } = require('../models');
const { QueryTypes } = require('sequelize');
require('dotenv').config();

const JWT_SECRET = process.env.JWT_SECRET;

/* ------------------------------ LOGIN (unchanged) ------------------------------ */
exports.login = async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ message: 'Email and password are required' });
  if (!JWT_SECRET) return res.status(500).json({ message: 'Server misconfigured (missing JWT secret)' });

  try {
    const rows = await sequelize.query(
      `SELECT id, name, email, role, password_hash
         FROM "Users"
        WHERE email = :email
        LIMIT 1`,
      { replacements: { email }, type: QueryTypes.SELECT }
    );

    const user = rows && rows[0];
    if (!user) return res.status(401).json({ message: 'Invalid email or password' });

    const ok = await bcrypt.compare(String(password), String(user.password_hash || ''));
    if (!ok) return res.status(401).json({ message: 'Invalid email or password' });

    const token = jwt.sign(
      { userId: user.id, email: user.email, role: user.role },
      JWT_SECRET,
      { expiresIn: '2h' }
    );

    return res.status(200).json({
      message: 'Login successful',
      token,
      user: { id: user.id, name: user.name, email: user.email, role: user.role }
    });
  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/* ------------------------------ 2FA (MVP) ------------------------------ */
const TWOFA_KEY = (userId) => `user:${userId}:2fa`;

exports.getTwoFAStatus = async (req, res) => {
  try {
    const userId = req.user?.id || req.user?.userId || null;
    if (!userId) return res.json({ enabled: false });
    const data = await Setting.get(TWOFA_KEY(userId), { enabled: false });
    return res.json({ enabled: !!data.enabled });
  } catch (err) {
    console.error('2FA status error:', err);
    return res.status(500).json({ enabled: false });
  }
};

exports.setupTwoFA = async (req, res) => {
  let speakeasy;
  try { speakeasy = require('speakeasy'); } catch {
    return res.status(501).json({ message: '2FA not available on server (install "speakeasy")' });
  }

  try {
    const userId = req.user?.id || req.user?.userId;
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });

    const secret = speakeasy.generateSecret({
      name: `MkopoSuite (${userId})`,
      length: 20,
    });

    await Setting.set(TWOFA_KEY(userId), { enabled: false, secret: secret.base32 }, userId);
    return res.json({ secret: secret.base32, otpauthUrl: secret.otpauth_url });
  } catch (err) {
    console.error('2FA setup error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

exports.verifyTwoFA = async (req, res) => {
  let speakeasy;
  try { speakeasy = require('speakeasy'); } catch {
    return res.status(501).json({ message: '2FA not available on server (install "speakeasy")' });
  }

  try {
    const userId = req.user?.id || req.user?.userId;
    const { token } = req.body || {};
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });
    if (!token) return res.status(400).json({ message: 'Token required' });

    const data = await Setting.get(TWOFA_KEY(userId), null);
    if (!data?.secret) return res.status(400).json({ message: '2FA not initialized' });

    const ok = speakeasy.totp.verify({
      secret: data.secret,
      encoding: 'base32',
      token: String(token),
      window: 1,
    });
    if (!ok) return res.status(400).json({ message: 'Invalid code' });

    await Setting.set(TWOFA_KEY(userId), { enabled: true, secret: data.secret }, userId);
    return res.json({ enabled: true });
  } catch (err) {
    console.error('2FA verify error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

exports.disableTwoFA = async (req, res) => {
  let speakeasy;
  try { speakeasy = require('speakeasy'); } catch {
    return res.status(501).json({ message: '2FA not available on server (install "speakeasy")' });
  }

  try {
    const userId = req.user?.id || req.user?.userId;
    const { token } = req.body || {};
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });

    const data = await Setting.get(TWOFA_KEY(userId), null);
    if (data?.secret && token) {
      const ok = speakeasy.totp.verify({
        secret: data.secret,
        encoding: 'base32',
        token: String(token),
        window: 1,
      });
      if (!ok) return res.status(400).json({ message: 'Invalid code' });
    }

    await Setting.set(TWOFA_KEY(userId), { enabled: false, secret: data?.secret || null }, userId);
    return res.json({ enabled: false });
  } catch (err) {
    console.error('2FA disable error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};
