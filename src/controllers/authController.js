'use strict';

const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { sequelize } = require('../models');
const { QueryTypes } = require('sequelize'); // ✅ proper QueryTypes source
require('dotenv').config();

const JWT_SECRET = process.env.JWT_SECRET;

exports.login = async (req, res) => {
  const { email, password } = req.body || {};

  if (!email || !password) {
    return res.status(400).json({ message: 'Email and password are required' });
  }
  if (!JWT_SECRET) {
    return res.status(500).json({ message: 'Server misconfigured (missing JWT secret)' });
  }

  try {
    // With QueryTypes.SELECT, sequelize returns an array of rows (no [rows, meta])
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
