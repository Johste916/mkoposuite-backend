'use strict';
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');

/** Env */
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';
const SELF_SIGNUP_ENABLED = process.env.SELF_SIGNUP_ENABLED === '1';
const DEFAULT_TRIAL_DAYS = Number(process.env.DEFAULT_TRIAL_DAYS || 14);

/** Small helper: pick first tenant for a user (if joined) */
async function getTenantIdForUser(models, userId) {
  const { TenantUser } = models || {};
  if (!TenantUser) return null;
  const link = await TenantUser.findOne({ where: { user_id: userId }, order: [['createdAt', 'ASC']] });
  return link ? link.tenant_id : null;
}

/** GET /api/signup/_selfcheck */
exports.selfcheck = async (req, res) => {
  try {
    const models = req.app.get('models') || {};
    const { sequelize, User, Tenant, TenantUser } = models;

    const dbOk = !!sequelize && (await sequelize.authenticate().then(() => true).catch(() => false));

    let usersCols = null;
    let tenantsCols = null;
    let tusersCols = null;

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
      schema: {
        Users: usersCols,
        tenants: tenantsCols,
        tenant_users: tusersCols,
      },
    });
  } catch (e) {
    console.error('[SIGNUP:_selfcheck] error', e);
    return res.status(500).json({ error: 'selfcheck failed' });
  }
};

/** POST /api/signup */
exports.signup = async (req, res) => {
  try {
    if (!SELF_SIGNUP_ENABLED) {
      return res.status(403).json({ error: 'Self-signup is disabled' });
    }

    const models = req.app.get('models') || {};
    const { sequelize, User, Tenant, TenantUser } = models;

    const { name, email, password, orgName } = req.body || {};
    if (!name || !email || !password) {
      return res.status(400).json({ error: 'name, email and password are required' });
    }

    // Make sure we can use password_hash even if defaultScope hides it
    const userModel = User.scope ? User.scope('withSensitive') : User;

    // Uniqueness check
    const existing = await userModel.findOne({ where: { email } });
    if (existing) return res.status(409).json({ error: 'Email already in use' });

    const password_hash = await bcrypt.hash(password, 10);

    // If we have Sequelize + both tenant models, do a full 3-step inside a single tx
    if (sequelize && Tenant && TenantUser) {
      const created = await sequelize.transaction(async (t) => {
        const tenant = await Tenant.create({
          id: uuidv4(),
          name: orgName || 'Organization',
          status: 'trial',
          plan_code: 'basic',
          trial_ends_at: new Date(Date.now() + DEFAULT_TRIAL_DAYS * 86400000).toISOString().slice(0, 10),
        }, { transaction: t });

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

    // 🔻 Graceful fallback: if Tenants aren’t wired yet, at least create the user
    const userOnly = await userModel.create({
      id: uuidv4(),
      name,
      email,
      password_hash,
      role: 'owner',
      branchId: null,
    });

    const tId = await getTenantIdForUser(models, userOnly.id);

    const token = jwt.sign(
      { id: userOnly.id, email: userOnly.email, tenantId: tId },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );

    return res.status(201).json({
      ok: true,
      token,
      user: userOnly.toJSON(),
      tenant: tId ? { id: tId } : null,
      note: 'Tenant linkage skipped (tenant models/tables not found).',
    });
  } catch (err) {
    // Map common PG errors cleanly
    const code = err?.original?.code || err?.parent?.code;
    if (code === '23505') return res.status(409).json({ error: 'Email already in use' });
    console.error('[SIGNUP] error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
