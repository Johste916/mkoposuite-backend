'use strict';
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
let bcrypt;
try { bcrypt = require('bcryptjs'); } catch {}
const { Op } = require('sequelize');

// normalize string
const s = v => (typeof v === 'string' ? v.trim() : '');
const slugify = (txt) =>
  s(txt).toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)+/g, '')
    .slice(0, 60);

// Read models if available
let db;
try { db = require('../models'); } catch { try { db = require('../../models'); } catch {} }

const getEnvBool = (val) => {
  if (val === true) return true;
  const str = String(val || '').toLowerCase().trim();
  return ['1','true','yes','on'].includes(str);
};

const hasCol = (model, col) =>
  !!(model?.rawAttributes &&
     (model.rawAttributes[col] ||
      Object.values(model.rawAttributes).some(a => a.field === col)));

const loginUrl = (email) => {
  const base = (process.env.FRONTEND_URL || '').replace(/\/$/, '');
  const path = process.env.FRONTEND_LOGIN_PATH || '/login';
  const url  = base ? `${base}${path}` : path;
  return email ? `${url}?email=${encodeURIComponent(email)}` : url;
};

exports.selfCheck = async (req, res) => {
  const env = {
    SELF_SIGNUP_ENABLED: getEnvBool(process.env.SELF_SIGNUP_ENABLED),
    JWT_SECRET_set: !!process.env.JWT_SECRET,
    JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '7d',
    NODE_ENV: process.env.NODE_ENV || 'development',
    FRONTEND_URL: process.env.FRONTEND_URL || null,
  };

  let dbOk = false;
  try { await db?.sequelize?.authenticate(); dbOk = true; } catch {}

  const models = {
    loaded: !!db,
    hasUser: !!db?.User,
    hasTenant: !!db?.Tenant,
    hasTenantUser: !!db?.TenantUser,
  };

  const schema = {};
  if (dbOk) {
    try {
      const [userCols] = await db.sequelize.query(`
        SELECT column_name FROM information_schema.columns
        WHERE table_schema='public' AND table_name='Users'
        ORDER BY ordinal_position
      `);
      schema.Users = userCols.map(c => c.column_name);
    } catch {}
    try {
      const [tenCols] = await db.sequelize.query(`
        SELECT column_name FROM information_schema.columns
        WHERE table_schema='public' AND table_name='tenants'
        ORDER BY ordinal_position
      `);
      schema.tenants = tenCols.map(c => c.column_name);
    } catch {}
    try {
      const [tuCols] = await db.sequelize.query(`
        SELECT column_name FROM information_schema.columns
        WHERE table_schema='public' AND table_name='tenant_users'
        ORDER BY ordinal_position
      `);
      schema.tenant_users = tuCols.map(c => c.column_name);
    } catch {}
  }

  res.json({ env, db: { ok: dbOk }, models, schema });
};

const pickBody = (req) => {
  // Accept JSON and multipart/form-data
  const b = req.body || {};
  // tolerate both camel & snake casing
  const companyName = s(b.companyName || b.company_name || b.org || b.organization);
  const adminName   = s(b.adminName   || b.admin_name   || b.name || b.fullname);
  const email       = s(b.email);
  const phone       = s(b.phone || b.phoneNumber || '');
  const password    = s(b.password || b.pass);
  const planCode    = s(b.planCode || b.plan_code || 'basic').toLowerCase();
  return { companyName, adminName, email, phone, password, planCode };
};

const validate = ({ companyName, adminName, email, password, planCode }) => {
  const errors = {};
  if (!companyName || companyName.length < 3) errors.companyName = 'Company name is required (min 3 chars).';
  if (!adminName || adminName.length < 3) errors.adminName = 'Admin name is required (min 3 chars).';
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) errors.email = 'Valid email is required.';
  if (!password || password.length < 6) errors.password = 'Password must be at least 6 characters.';
  if (!planCode) errors.planCode = 'Plan code is required.';
  return errors;
};

exports.signup = async (req, res) => {
  try {
    if (!getEnvBool(process.env.SELF_SIGNUP_ENABLED)) {
      return res.status(403).json({ error: 'Signup is disabled on this environment.' });
    }
    if (!process.env.JWT_SECRET) {
      return res.status(500).json({ error: 'JWT_SECRET is not set on the server.' });
    }
    if (!db?.User) {
      return res.status(500).json({ error: 'User model is unavailable.' });
    }

    const body = pickBody(req);
    const errors = validate(body);
    if (Object.keys(errors).length) {
      return res.status(400).json({ error: 'Validation failed', fields: errors });
    }

    const { companyName, adminName, email, phone, password, planCode } = body;

    // Check for existing user (case-insensitive)
    const existing = await db.User.findOne({ where: { email: { [Op.iLike]: email } } });
    if (existing) {
      return res.status(409).json({
        code: 'ALREADY_REGISTERED',
        error: 'User already registered in the system.',
        redirectTo: loginUrl(email),
        paidPlatformUrl: process.env.PAID_PLATFORM_URL || null
      });
    }

    // Hash password → password_hash column
    const hash = bcrypt
      ? await bcrypt.hash(password, 10)
      : crypto.createHash('sha256').update(password).digest('hex'); // fallback for environments without bcrypt

    const t = await db.sequelize.transaction();

    try {
      // Create tenant if model exists
      let tenant = null;
      if (db.Tenant) {
        let slug = slugify(companyName) || (crypto.randomUUID ? crypto.randomUUID().slice(0, 8) : String(Date.now()));

        // Ensure unique slug if slug column exists
        if (hasCol(db.Tenant, 'slug')) {
          let candidate = slug, i = 1;
          // eslint-disable-next-line no-constant-condition
          while (true) {
            const exists = await db.Tenant.findOne({ where: { slug: candidate } });
            if (!exists) { slug = candidate; break; }
            i += 1;
            candidate = `${slug}-${i}`;
            if (candidate.length > 64) candidate = `${slug.slice(0, 64 - String(i).length - 1)}-${i}`;
          }
        }

        // Build tenant payload and include only columns that exist in the model
        const tenantData = {
          name: companyName,
          status: 'trial',
          plan_code: planCode || 'basic',
          trial_ends_at: process.env.DEFAULT_TRIAL_DAYS
            ? new Date(Date.now() + Number(process.env.DEFAULT_TRIAL_DAYS) * 86400000)
            : null,
          billing_email: email,
          auto_disable_overdue: false,
          grace_days: 7,
        };

        // 🔹 supply commonly-required columns if present in DB/model
        if (hasCol(db.Tenant, 'slug'))     tenantData.slug     = slug;
        if (hasCol(db.Tenant, 'country'))  tenantData.country  = process.env.DEFAULT_COUNTRY  || 'TZ';
        if (hasCol(db.Tenant, 'currency')) tenantData.currency = process.env.DEFAULT_CURRENCY || 'TZS';
        if (hasCol(db.Tenant, 'staff_count') && tenantData.staff_count == null) tenantData.staff_count = 0;

        tenant = await db.Tenant.create(tenantData, { transaction: t });
      }

      // Create user
      const user = await db.User.create({
        name: adminName,
        email,
        password_hash: hash,
        role: 'owner',
        branchId: null,
      }, { transaction: t });

      // Link user to tenant if join table exists
      if (tenant && db.TenantUser) {
        await db.TenantUser.create({
          tenant_id: tenant.id,
          user_id: user.id,
          role: 'owner',
        }, { transaction: t });
      }

      await t.commit();

      // JWT (kept for your existing flow)
      const token = jwt.sign(
        { id: user.id, email: user.email, role: user.role, tenantId: tenant ? tenant.id : null },
        process.env.JWT_SECRET,
        { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
      );

      // Send next.loginUrl (used by your SPA on success redirect)
      return res.status(201).json({
        ok: true,
        token,
        user,
        tenant: tenant || null,
        requireEmailVerification: getEnvBool(process.env.REQUIRE_EMAIL_VERIFICATION),
        next: { loginUrl: loginUrl() },
        note: tenant ? undefined : 'Tenant linkage skipped (tenant model/table not available).',
      });
    } catch (err) {
      await t.rollback();

      // Better diagnostics to the client
      const code   = err?.original?.code || err?.parent?.code || err?.code;
      const detail = err?.original?.detail || err?.parent?.detail || err?.message;

      if (code === '23505') { // unique_violation
        return res.status(409).json({
          code: 'ALREADY_REGISTERED',
          error: 'User already registered in the system.',
          redirectTo: loginUrl(email),
          paidPlatformUrl: process.env.PAID_PLATFORM_URL || null,
          detail
        });
      }
      if (code === '23502') { // not_null_violation
        return res.status(400).json({ error: 'Missing required field on tenant/user.', code, detail });
      }
      return res.status(500).json({ error: 'Signup failed.', code, detail });
    }
  } catch (e) {
    return res.status(500).json({ error: e.message || 'Internal error.' });
  }
};
