'use strict';

const bcrypt = require('bcryptjs');
const { sequelize } = require('../models');
const { QueryTypes } = require('sequelize');

const SELF_SIGNUP_ENABLED = (process.env.SELF_SIGNUP_ENABLED || '0') === '1';
const DEFAULT_TRIAL_DAYS = Number(process.env.DEFAULT_TRIAL_DAYS || 14);

exports.status = async (_req, res) => {
  return res.json({
    enabled: SELF_SIGNUP_ENABLED,
    defaultTrialDays: DEFAULT_TRIAL_DAYS,
    requireEmailVerification: (process.env.REQUIRE_EMAIL_VERIFICATION || '0') === '1'
  });
};

async function usersTableName() {
  // Prefer the existing "Users" table (Sequelize default), else fallback to lowercased users
  const q = `
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema='public'
      AND table_name IN ('Users','users')
    ORDER BY CASE WHEN table_name='Users' THEN 0 ELSE 1 END
    LIMIT 1;
  `;
  const rows = await sequelize.query(q, { type: QueryTypes.SELECT });
  return rows[0]?.table_name || 'Users';
}

async function tableColumns(table) {
  const rows = await sequelize.query(
    `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema='public' AND table_name=:t
    `,
    { type: QueryTypes.SELECT, replacements: { t: table } }
  );
  return new Set(rows.map(r => r.column_name));
}

/**
 * Insert a user safely:
 * - Always write bcrypt hash to password_hash if it exists
 * - If a legacy 'password' column exists AND is NOT NULL constrained, we can write the same hashed value,
 *   otherwise omit it.
 */
async function insertUser({ name, email, role, phone, password }) {
  const table = await usersTableName();
  const cols = await tableColumns(table);

  // Hash the password correctly for new signups
  const passwordHash = await bcrypt.hash(String(password), 10);

  // Decide which columns to include
  const now = new Date();
  const toInsert = {};
  if (cols.has('name')) toInsert.name = name || null;
  if (cols.has('email')) toInsert.email = email;
  if (cols.has('role')) toInsert.role = role || 'user';
  if (cols.has('phone')) toInsert.phone = phone || null;
  if (cols.has('password_hash')) toInsert.password_hash = passwordHash;

  // If there's a legacy `password` column, write the same (hashed) value just to satisfy NOT NULL, if any.
  if (cols.has('password') && !cols.has('password_hash')) {
    toInsert.password = passwordHash;
  } else if (cols.has('password')) {
    // write null if allowed; if it explodes, your schema requires a value and we can fall back to the hash
    toInsert.password = null;
  }

  if (cols.has('createdAt')) toInsert.createdAt = now;
  if (cols.has('updatedAt')) toInsert.updatedAt = now;
  if (cols.has('created_at')) toInsert.created_at = now;
  if (cols.has('updated_at')) toInsert.updated_at = now;

  const fields = Object.keys(toInsert);
  const params = fields.map((f, i) => `:v${i}`);

  const sql = `INSERT INTO "${table}" (${fields.map(f => `"${f}"`).join(',')})
               VALUES (${params.join(',')})
               RETURNING id, name, email, role`;
  const replacements = {};
  fields.forEach((f, i) => { replacements[`v${i}`] = toInsert[f]; });

  const rows = await sequelize.query(sql, { type: QueryTypes.INSERT, replacements, returning: true });
  // Sequelize returns [resultRows, metadata]; normalize
  const ret = Array.isArray(rows) ? (rows[0]?.[0] || rows[0]) : rows;
  return ret || { id: undefined, name, email, role };
}

exports.signup = async (req, res) => {
  try {
    if (!SELF_SIGNUP_ENABLED) {
      return res.status(403).json({ error: 'Self-signup is disabled.' });
    }

    const b = req.body || {};
    const companyName = (b.companyName || '').toString().trim();
    const adminName = (b.adminName || '').toString().trim();
    const email = (b.email || '').toString().trim().toLowerCase();
    const phone = (b.phone || '').toString().trim();
    const password = (b.password || '').toString();
    const planCode = (b.planCode || 'basic').toString().toLowerCase();

    if (!companyName || !email || !password) {
      return res.status(400).json({ error: 'companyName, email and password are required' });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    // Ensure email unique
    const table = await usersTableName();
    const existing = await sequelize.query(
      `SELECT 1 FROM "${table}" WHERE LOWER(email)=LOWER(:email) LIMIT 1`,
      { type: QueryTypes.SELECT, replacements: { email } }
    );
    if (existing && existing[0]) {
      return res.status(409).json({ error: 'Email already in use' });
    }

    // Create the user with a proper bcrypt hash in password_hash
    const user = await insertUser({
      name: adminName || companyName,
      email,
      role: 'admin',
      phone,
      password,
    });

    // (Optional) create a tenant/org if your schema expects it — kept no-op to avoid breaking anything.
    // If you already have a tenants table+controller wired, it will continue to work as before.

    return res.status(201).json({
      ok: true,
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
      trialDays: DEFAULT_TRIAL_DAYS,
      plan: planCode,
      requireEmailVerification: (process.env.REQUIRE_EMAIL_VERIFICATION || '0') === '1',
      next: { loginUrl: '/login' },
    });
  } catch (e) {
    console.error('Signup error:', e);
    return res.status(500).json({ error: e?.message || 'Failed to create account' });
  }
};
