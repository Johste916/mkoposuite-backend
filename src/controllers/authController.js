'use strict';

const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { sequelize } = require('../models');
const { QueryTypes } = require('sequelize');
require('dotenv').config();

const JWT_SECRET = process.env.JWT_SECRET;

// POST /api/login  and  POST /api/auth/login
exports.login = async (req, res) => {
  const { email, password } = req.body || {};

  if (!email || !password) {
    return res.status(400).json({ message: 'Email and password are required' });
  }
  if (!JWT_SECRET) {
    return res.status(500).json({ message: 'Server misconfigured (missing JWT secret)' });
  }

  try {
    // Case-insensitive lookup; keep quoted table for Postgres default names.
    const rows = await sequelize.query(
      `SELECT id, name, email, role, password_hash
       FROM "Users"
       WHERE LOWER(email) = LOWER(:email)
       LIMIT 1`,
      { replacements: { email }, type: QueryTypes.SELECT }
    );

    const user = rows && rows[0];
    if (!user) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    // Try common legacy columns if your schema changed in the past
    const hashed =
      user.password_hash ??
      user.passwordHash ??
      user.password ??
      '';

    const ok = await bcrypt.compare(String(password), String(hashed));
    if (!ok) {
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
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
    });
  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// GET /api/auth/2fa/status  (frontend calls this; keep disabled for now)
exports.getTwoFAStatus = async (_req, res) => {
  return res.json({
    enabled: false,
    method: null,
    backupCodesRemaining: 0,
  });
};
