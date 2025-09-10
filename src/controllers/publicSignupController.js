'use strict';
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';
const SELF_SIGNUP_ENABLED = process.env.SELF_SIGNUP_ENABLED === '1';
const DEFAULT_TRIAL_DAYS = Number(process.env.DEFAULT_TRIAL_DAYS || 14);

// pick first non-empty string from aliases
function pick(obj, aliases = []) {
  for (const key of aliases) {
    const v = obj?.[key];
    if (typeof v === 'string' && v.trim().length) return v.trim();
  }
  return undefined;
}

// allow bodies wrapped in {payload:{...}} or {user:{...}}
function normalizeBody(body) {
  const b = body || {};
  return (b.payload && typeof b.payload === 'object') ? b.payload
       : (b.user && typeof b.user === 'object') ? b.user
       : b;
}

async function getTenantIdForUser(models, userId) {
  const { TenantUser } = models || {};
  if (!TenantUser) return null;
  const link = await TenantUser.findOne({
    where: { user_id: userId },
    order: [['createdAt', 'ASC']]
  });
  return link ? link.tenant_id : null;
}

exports.selfcheck = async (req, res) => {
  try {
    const models = req.app.get('models') || {};
    const { sequelize, User, Tenant, TenantUser } = models;
    const dbOk = !!sequelize && (await sequelize.authenticate().then(() => true).catch(() => false));

    let usersCols = null, tenantsCols = null, tusersCols = null;
    if (dbOk) {
      const [u] = await sequelize.query(`
        SELECT column_name FROM information_schema.columns
        WHERE table_schema='public' AND table_name='Users' ORDER BY ordinal_position
      `);
      usersCols = u.map(r => r.column_name);

      const [t] = await sequelize.query(`
        SELECT column_name FROM information_schema.columns
        WHERE table_schema='public' AND table_name='tenants' ORDER BY ordinal_position
      `).catch(() => [null]);
      tenantsCols = t ? t.map(r => r.column_name) : null;

      const [tu] = await sequelize.query(`
        SELECT column_name FROM information_schema.columns
        WHERE table_schema='public' AND table_name='tenant_users' ORDER BY ordinal_position
      `).catch(() => [null]);
      tusersCols = tu ? tu.map(r => r.column_name) : null;
    }

    return res.json({
      env: {
        SELF_SIGNUP_ENABLED,
        JWT_SECRET_set: !!process.env.JWT_SECRET,
        JWT_EXPIRES_IN,
        NODE_ENV: process.env.NODE_ENV,
        FRONTEND_URL: process.env.FRONTEND_URL,
      },
      db: { ok: dbOk },
      models: {
        loaded: !!models && Object.keys(models).length > 0,
        hasUser: !!User,
        hasTenant: !!Tenant,
        hasTenantUser: !!TenantUser,
      },
      schema: { Users: usersCols, tenants: tenantsCols, tenant_users: tusersCols },
    });
  } catch (e) {
    console.error('[SIGNUP:_selfcheck] error', e);
    return res.status(500).json({ error: 'selfcheck failed' });
  }
};

exports.signup = async (req, res) => {
  try {
    if (!SELF_SIGNUP_ENABLED) {
      return res.status(403).json({ error: 'Self-signup is disabled' });
    }

    const models = req.app.get('models') || {};
    const { sequelize, User, Tenant, TenantUser } = models;

    const raw = normalizeBody(req.body);

    // 🔑 Accept your current keys & old ones:
    // name: adminName | name | fullName | username | ownerName
    // org : companyName | orgName | organization | company | tenantName
    // plan: planCode | plan | plan_code
    // phone optional
    const name     = pick(raw, ['adminName', 'name', 'fullName', 'username', 'ownerName']);
    const email    = pick(raw, ['email', 'emailAddress']);
    const password = pick(raw, ['password', 'pass', 'pwd']);
    const orgName  = pick(raw, ['companyName', 'orgName', 'organization', 'company', 'tenantName']) || 'Organization';
    const phone    = pick(raw, ['phone', 'phoneNumber', 'mobile']); // ignored unless you add a column
    const planCode = (pick(raw, ['planCode', 'plan', 'plan_code']) || 'basic').toLowerCase();

    const missing = [];
    if (!name) missing.push('name/adminName');
    if (!email) missing.push('email');
    if (!password) missing.push('password');
    if (missing.length) {
      return res.status(400).json({ error: 'Missing required fields', missing });
    }

    const userModel = User.scope ? User.scope('withSensitive') : User;

    const exists = await userModel.findOne({ where: { email } });
    if (exists) return res.status(409).json({ error: 'Email already in use' });

    const password_hash = await bcrypt.hash(password, 10);

    // If we have full tenant stack, create tenant + user + link in one TX
    if (sequelize && Tenant && TenantUser) {
      const created = await sequelize.transaction(async (t) => {
        const tenant = await Tenant.create({
          id: uuidv4(),
          name: orgName,
          status: 'trial',
          plan_code: planCode,
          trial_ends_at: new Date(Date.now() + DEFAULT_TRIAL_DAYS * 86400000).toISOString().slice(0, 10),
        }, { transaction: t });

        // NOTE: Users table has no 'phone' column in your schema -> we ignore it safely.
        const user = await userModel.create({
          id: uuidv4(),
          name,
          email,
          password_hash,
          role: 'owner',
          branchId: null,
        }, { transaction: t });

        await TenantUser.create({
          id: uuidv4(),
          tenant_id: tenant.id,
          user_id: user.id,
          role: 'owner',
        }, { transaction: t });

        return { user, tenant };
      });

      const token = jwt.sign(
        { id: created.user.id, email: created.user.email, tenantId: created.tenant.id },
        JWT_SECRET,
        { expiresIn: JWT_EXPIRES_IN }
      );

      return res.status(201).json({
        ok: true,
        token,
        user: created.user.toJSON(),
        tenant: created.tenant,
      });
    }

    // Fallback: only user (if tenant models/tables unavailable)
    const user = await userModel.create({
      id: uuidv4(),
      name, email, password_hash, role: 'owner', branchId: null,
    });
    const tId = await getTenantIdForUser(models, user.id);
    const token = jwt.sign(
      { id: user.id, email: user.email, tenantId: tId },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );

    return res.status(201).json({
      ok: true,
      token,
      user: user.toJSON(),
      tenant: tId ? { id: tId } : null,
      note: 'Tenant linkage skipped (tenant models/tables not found).',
    });

  } catch (err) {
    const code = err?.original?.code || err?.parent?.code;
    if (code === '23505') return res.status(409).json({ error: 'Email already in use' });
    console.error('[SIGNUP] error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
