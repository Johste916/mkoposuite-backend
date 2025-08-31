'use strict';

const jwt = require('jsonwebtoken');
const db = require('../models');
const { User, Role, Branch, Permission } = db;

/* ------------------------------ helpers ------------------------------ */
function getBearerToken(header) {
  if (!header) return null;
  const [scheme, token] = String(header).split(' ');
  if (!/^Bearer$/i.test(scheme) || !token) return null;
  return token.trim();
}

/** also accept httpOnly cookie named "token" as a fallback */
function getTokenFromReq(req) {
  const hToken = getBearerToken(req.headers.authorization);
  const cToken = req.cookies?.token || null; // if cookie-parser is used
  return hToken || cToken || null;
}

function pickAttrs(model, names) {
  const raw = model?.rawAttributes || {};
  return names.filter((n) => !!raw[n]);
}

function pickFirstAssocName(model, candidates = []) {
  const m = model || {};
  const assoc = Object.keys(m.associations || {});
  return candidates.find((x) => assoc.includes(x)) || null;
}

/* --------------------------- core middleware ------------------------- */
async function authenticateUser(req, res, next) {
  try {
    const token = getTokenFromReq(req);
    if (!token) return next();

    const secret = process.env.JWT_SECRET || process.env.JWT_KEY;
    if (!secret) {
      // keep your current behavior (explicit error) to avoid silent auth bypass
      console.error('JWT secret is not set (JWT_SECRET or JWT_KEY).');
      return res.status(500).json({ error: 'Server misconfigured: JWT secret missing' });
    }

    let payload;
    try {
      payload = jwt.verify(token, secret);
    } catch {
      // invalid/expired token -> treat as anonymous; do not hard error here
      return next();
    }

    const normalizedId = payload.id ?? payload.userId ?? payload.uid ?? payload.sub ?? null;

    let roleName = payload.role || null;
    let rolesList =
      (Array.isArray(payload.Roles) && payload.Roles.map((r) => r?.name).filter(Boolean)) ||
      (Array.isArray(payload.roles) && payload.roles.map(String)) ||
      null;

    let dbUser = null;
    if ((!roleName || !rolesList || !payload.email || !payload.name) && normalizedId && User) {
      const attrs = pickAttrs(User, [
        'id',
        'email',
        'name',
        'fullName',
        'role',
        'branchId',
        'tenantId',
        'isActive',
        'status',
      ]);

      // detect associations safely
      const rolesAlias = pickFirstAssocName(User, ['roles', 'Roles', 'Role']);
      const branchAlias = pickFirstAssocName(User, ['homeBranch', 'Branch']); // your model uses 'homeBranch'

      const include = [];
      if (Role && rolesAlias) {
        include.push({
          model: Role,
          as: rolesAlias,
          attributes: ['id', 'name', 'code', 'slug'],
          through: { attributes: [] },
          required: false,
        });
      }
      if (Branch && branchAlias) {
        include.push({
          model: Branch,
          as: branchAlias,
          attributes: ['id', 'name', 'code'],
          required: false,
        });
      }

      try {
        dbUser = await User.findByPk(normalizedId, { attributes: attrs, include });
      } catch (e) {
        console.warn('authMiddleware: enrich include failed, retrying without include:', e.message);
        dbUser = await User.findByPk(normalizedId, { attributes: attrs });
      }

      if (dbUser) {
        const assoc =
          (rolesAlias && dbUser[rolesAlias]) ||
          dbUser.roles ||
          dbUser.Roles ||
          [];
        const names = Array.isArray(assoc)
          ? assoc.map((r) => r?.name || r?.code || r?.slug).filter(Boolean)
          : [];

        if (!roleName) roleName = names[0] || dbUser.role || null;
        if (!rolesList) rolesList = names.length ? names : dbUser.role ? [dbUser.role] : null;
      }
    }

    const userObj = {
      id: normalizedId || dbUser?.id || payload.id,
      email: dbUser?.email ?? payload.email ?? null,
      name: dbUser?.name ?? dbUser?.fullName ?? payload.name ?? payload.fullName ?? null,
      role: roleName || null,
      tenantId: dbUser?.tenantId ?? payload.tenantId ?? null,
      branchId: dbUser?.branchId ?? payload.branchId ?? null,
      isActive: (dbUser?.isActive ?? dbUser?.status) ?? payload.isActive ?? true,
    };

    if (Array.isArray(rolesList)) {
      userObj.roles = rolesList;
      // keep a Roles array to not break code expecting that shape
      userObj.Roles = rolesList.map((name) => ({ name }));
    }

    req.user = userObj;
    return next();
  } catch (err) {
    console.error('Auth middleware error:', err);
    return res.status(500).json({ error: 'Authentication error' });
  }
}

function requireAuth(req, res, next) {
  if (!req.user?.id) return res.status(401).json({ error: 'Unauthorized' });
  return next();
}

/**
 * Accepts either a single role or list. Grants access if:
 * - req.user.role matches (case-insensitive), OR
 * - any of req.user.roles matches.
 */
function authorizeRoles(...roles) {
  const allow = roles.map((r) => String(r).toLowerCase());
  return (req, res, next) => {
    const primary = (req.user?.role || '').toLowerCase();
    const all = Array.isArray(req.user?.roles) ? req.user.roles.map((r) => String(r).toLowerCase()) : [];

    if (!primary && all.length === 0) return res.status(401).json({ error: 'Unauthorized' });
    const ok = allow.length === 0 || allow.includes(primary) || all.some((r) => allow.includes(r));

    if (!ok) return res.status(403).json({ error: 'Access denied: insufficient role' });
    next();
  };
}

/* ------------------------------- /auth/me --------------------------------- */
/**
 * Handler to return the current user, with optional Roles/Branch and computed permissions.
 * Mount like:
 *   router.get('/me', authenticateUser, requireAuth, me);
 */
async function me(req, res) {
  try {
    if (!req.user?.id) return res.status(401).json({ error: 'Unauthorized' });

    // Try to hydrate from DB to include associations; fall back to req.user
    let user = null;

    if (User && typeof User.findByPk === 'function') {
      const attrs = pickAttrs(User, [
        'id',
        'email',
        'name',
        'fullName',
        'role',
        'branchId',
        'tenantId',
        'isActive',
        'status',
        'createdAt',
        'updatedAt',
      ]);

      const rolesAlias = pickFirstAssocName(User, ['roles', 'Roles', 'Role']);
      const branchAlias = pickFirstAssocName(User, ['homeBranch', 'Branch']);

      const include = [];
      if (Role && rolesAlias) {
        include.push({
          model: Role,
          as: rolesAlias,
          attributes: ['id', 'name', 'code', 'slug'],
          through: { attributes: [] },
          required: false,
        });
      }
      if (Branch && branchAlias) {
        include.push({
          model: Branch,
          as: branchAlias,
          attributes: ['id', 'name', 'code'],
          required: false,
        });
      }

      try {
        user = await User.findByPk(req.user.id, { attributes: attrs, include });
      } catch (e) {
        user = await User.findByPk(req.user.id, { attributes: attrs });
      }
    }

    const base = user ? user.toJSON() : { ...req.user };

    // Normalize role string
    base.role = base.role || base.Roles?.[0]?.name || base.roles?.[0] || 'user';

    // Compute permissions from Permission table if present (action + roles[] JSONB)
    let permissions = [];
    try {
      if (Permission && typeof Permission.findAll === 'function') {
        const rows = await Permission.findAll({ attributes: ['action', 'roles'], raw: true });
        const myRoles = [
          (base.role || '').toLowerCase(),
          ...(Array.isArray(base.roles) ? base.roles.map((r) => String(r).toLowerCase()) : []),
        ].filter(Boolean);

        permissions = rows
          .filter((r) => Array.isArray(r.roles) && r.roles.some((x) => myRoles.includes(String(x).toLowerCase())))
          .map((r) => r.action);
      }
    } catch {
      // ignore; table might not exist in dev
    }

    base.permissions = permissions;

    return res.json(base);
  } catch (e) {
    console.error('GET /auth/me failed:', e);
    return res.status(500).json({ error: 'Failed to load current user' });
  }
}

module.exports = {
  authenticateUser,
  requireAuth,
  authorizeRoles,
  me, // <— add this export and mount it on /api/auth/me
};
