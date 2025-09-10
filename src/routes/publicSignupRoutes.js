'use strict';
const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

/**
 * Helpers
 */
const envOn = (k, def = '0') => String(process.env[k] ?? def).trim() === '1';
const requireEnabled = (req, res, next) => {
  if (!envOn('SELF_SIGNUP_ENABLED')) {
    return res.status(404).json({ error: 'Signup is disabled' });
  }
  next();
};

function signToken(payload) {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw Object.assign(new Error('JWT_SECRET is missing'), { expose: true, status: 500 });
  const expiresIn = process.env.JWT_EXPIRES_IN || '7d';
  return jwt.sign(payload, secret, { expiresIn });
}

function daysFromNow(n) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + Number(n || 0));
  return d.toISOString().slice(0, 10); // yyyy-mm-dd
}

/**
 * In-memory fallback (keeps UI working if DB/models missing)
 */
const MEM = {
  tenants: new Map(),
  users: new Map(),
};
function memCreateTenant({ name, trialEndsAt }) {
  const id = crypto.randomUUID ? crypto.randomUUID() : String(Date.now());
  const now = new Date().toISOString();
  const t = {
    id,
    name,
    status: 'trial',
    plan_code: 'basic',
    trial_ends_at: trialEndsAt || null,
    created_at: now,
    updated_at: now,
  };
  MEM.tenants.set(id, t);
  return t;
}
function memCreateUser({ name, email, passwordHash }) {
  const id = crypto.randomUUID ? crypto.randomUUID() : String(Date.now());
  const now = new Date().toISOString();
  const u = { id, name, email, password_hash: passwordHash, role: 'owner', createdAt: now, updatedAt: now };
  MEM.users.set(id, u);
  return u;
}

/**
 * Detects Users table column for password (password_hash vs password).
 */
async function detectPasswordColumn(sequelize) {
  try {
    const qi = sequelize.getQueryInterface();
    const desc = await qi.describeTable('Users');
    if (desc.password_hash) return 'password_hash';
    if (desc.password) return 'password';
    return null;
  } catch (e) {
    // Table missing or other DB error
    return null;
  }
}

/**
 * POST /api/signup
 * Body: { orgName, name, email, password, phone? }
 */
router.post('/', requireEnabled, async (req, res) => {
  try {
    const { orgName, name, email, password, phone } = req.body || {};
    if (!orgName || !name || !email || !password) {
      return res.status(400).json({ error: 'orgName, name, email and password are required' });
    }
    if (String(password).length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    const models = req.app.get('models');
    const trialDays = Number(process.env.DEFAULT_TRIAL_DAYS || 14);
    const trialEndsAt = trialDays > 0 ? daysFromNow(trialDays) : null;
    const passwordHash = await bcrypt.hash(String(password), 10);

    // No models? Use in-memory fallback
    if (!models || !models.sequelize) {
      const t = memCreateTenant({ name: orgName, trialEndsAt });
      const u = memCreateUser({ name, email: String(email).toLowerCase(), passwordHash });
      const token = signToken({ id: u.id, email: u.email, tenantId: t.id });
      return res.status(201).json({ ok: true, tenant: t, user: u, token, note: 'MEMORY_FALLBACK' });
    }

    const { sequelize } = models;
    const Tenant      = models.Tenant;      // table: tenants (snake timestamps)
    const TenantUser  = models.TenantUser;  // table: tenant_users (optional)
    const UserModel   = models.User;        // model maps to Users
    const Setting     = models.Setting;     // optional

    // Which column holds the password?
    const passwordCol = await detectPasswordColumn(sequelize);

    // Do it all in a transaction
    const result = await sequelize.transaction(async (tx) => {
      // Create tenant
      let tenantRow;
      if (Tenant && typeof Tenant.create === 'function') {
        tenantRow = await Tenant.create({
          name: orgName,
          status: 'trial',
          plan_code: 'basic',
          trial_ends_at: trialEndsAt,
        }, { transaction: tx });
      } else {
        // raw fallback (if model file missing but table exists)
        const [rows] = await sequelize.query(
          `INSERT INTO "tenants"(id,name,status,plan_code,trial_ends_at,created_at,updated_at)
           VALUES (gen_random_uuid(), :name, 'trial', 'basic', :trialEndsAt, NOW(), NOW())
           RETURNING *`,
          { transaction: tx, replacements: { name: orgName, trialEndsAt } }
        );
        tenantRow = rows[0];
      }

      // Enforce unique email
      const [existing] = await sequelize.query(
        `SELECT id FROM "Users" WHERE lower(email)=lower(:email) LIMIT 1`,
        { transaction: tx, replacements: { email } }
      );
      if (existing && existing[0]) {
        const err = new Error('Email already exists');
        err.status = 409;
        throw err;
      }

      // Create user (supports password_hash or password)
      let userRow;
      if (passwordCol === 'password_hash') {
        if (UserModel && UserModel.create) {
          userRow = await UserModel.create({
            name,
            email: String(email).toLowerCase(),
            password_hash: passwordHash,
            role: 'owner',
          }, { transaction: tx });
        } else {
          const [rows] = await sequelize.query(
            `INSERT INTO "Users"(id,name,email,password_hash,role,"createdAt","updatedAt")
             VALUES (gen_random_uuid(), :name, :email, :pw, 'owner', NOW(), NOW())
             RETURNING *`,
            { transaction: tx, replacements: { name, email: String(email).toLowerCase(), pw: passwordHash } }
          );
          userRow = rows[0];
        }
      } else if (passwordCol === 'password') {
        // direct SQL insert because your model maps to password_hash
        const [rows] = await sequelize.query(
          `INSERT INTO "Users"(id,name,email,"password",role,"createdAt","updatedAt")
           VALUES (gen_random_uuid(), :name, :email, :pw, 'owner', NOW(), NOW())
           RETURNING *`,
          { transaction: tx, replacements: { name, email: String(email).toLowerCase(), pw: passwordHash } }
        );
        userRow = rows[0];
      } else {
        const err = new Error(
          'Users table is missing both "password_hash" and "password" columns. Run the Users migration.'
        );
        err.status = 500;
        throw err;
      }

      // Link to tenant if join table/model exists
      if (TenantUser && TenantUser.create) {
        try {
          await TenantUser.create({
            tenant_id: tenantRow.id,
            user_id: userRow.id,
            role: 'owner',
          }, { transaction: tx });
        } catch (_) {
          // ignore if tenant_users table missing
        }
      }

      // Seed minimal settings (optional)
      if (Setting && Setting.set) {
        try {
          await Setting.merge('org.profile', { name: orgName, phone: phone || null }, { tenantId: tenantRow.id, updatedBy: userRow.id });
        } catch (_) {}
      }

      return { tenant: tenantRow, user: userRow };
    });

    const token = signToken({ id: result.user.id, email: result.user.email, tenantId: result.tenant.id });
    return res.status(201).json({ ok: true, ...result, token });
  } catch (err) {
    const pgCode = err?.original?.code || err?.parent?.code;
    let status = err.status || 500;
    let msg = err.expose ? err.message : null;

    if (!msg) {
      if (pgCode === '42P01') msg = 'A required table is missing. Run DB migrations.';
      else if (pgCode === '42703') msg = 'A required column is missing. Ensure migrations match the model.';
      else if (pgCode === '23505') { msg = 'Email already exists.'; status = 409; }
      else msg = err.message || 'Internal server error';
    }

    if (process.env.NODE_ENV !== 'production') console.error('[SIGNUP] Error:', err);
    return res.status(status).json({ error: msg, code: pgCode || undefined });
  }
});

/**
 * GET /api/signup/status — quick probe
 */
router.get('/status', (req, res) => {
  res.json({
    enabled: envOn('SELF_SIGNUP_ENABLED'),
    nodeEnv: process.env.NODE_ENV,
    haveModels: !!req.app.get('models'),
  });
});

module.exports = router;
