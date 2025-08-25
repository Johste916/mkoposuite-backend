// src/middleware/authMiddleware.js
'use strict';

const jwt = require('jsonwebtoken');
const db = require('../models');
const { User, Role } = db;

// Extract "Bearer <token>" safely (case-insensitive)
function getBearerToken(header) {
  if (!header) return null;
  const [scheme, token] = String(header).split(' ');
  if (!/^Bearer$/i.test(scheme) || !token) return null;
  return token.trim();
}

// pick only attributes that actually exist on the model (avoids "unknown column" errors)
function pickAttrs(model, names) {
  const raw = model?.rawAttributes || {};
  return names.filter((n) => !!raw[n]);
}

async function authenticateUser(req, res, next) {
  try {
    const token = getBearerToken(req.headers.authorization);
    if (!token) return next(); // guest; route-level guards will enforce auth

    const secret = process.env.JWT_SECRET || process.env.JWT_KEY;
    if (!secret) {
      console.error('JWT secret is not set (JWT_SECRET or JWT_KEY).');
      return res.status(500).json({ error: 'Server misconfigured: JWT secret missing' });
    }

    let payload;
    try {
      payload = jwt.verify(token, secret);
    } catch {
      // invalid token -> treat as guest; protected routes will reject later
      return next();
    }

    // Normalize possible id fields from various issuers
    const normalizedId = payload.id ?? payload.userId ?? payload.uid ?? payload.sub ?? null;

    // Role info from token (if present)
    let roleName = payload.role || null;
    let rolesList =
      (Array.isArray(payload.Roles) && payload.Roles.map((r) => r?.name).filter(Boolean)) ||
      (Array.isArray(payload.roles) && payload.roles.map(String)) ||
      null;

    // ---- Enrich from DB if needed (and id available) ----
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

      // Figure out the actual alias registered for the Role association
      const assocNames = Object.keys(User?.associations || {});
      const rolesAlias =
        assocNames.includes('roles')
          ? 'roles'
          : assocNames.includes('Roles')
          ? 'Roles'
          : assocNames.includes('Role')
          ? 'Role'
          : null;

      // Build include only if the association exists
      const include =
        Role && rolesAlias
          ? [{ model: Role, as: rolesAlias, attributes: ['id', 'name', 'code', 'slug'], through: { attributes: [] }, required: false }]
          : [];

      try {
        dbUser = await User.findByPk(normalizedId, { attributes: attrs, include });
      } catch (e) {
        // Fallback: retry without include so a bad alias never logs you out
        console.warn('authMiddleware: enrich include failed, retrying without include:', e.message);
        dbUser = await User.findByPk(normalizedId, { attributes: attrs });
      }

      if (dbUser) {
        // Prefer roles from association if we have them
        const assoc =
          (rolesAlias && dbUser[rolesAlias]) ||
          dbUser.roles || // some ORMs hydrate lower-case even if alias was caps
          dbUser.Roles ||
          [];

        const names = Array.isArray(assoc) ? assoc.map((r) => r?.name || r?.code || r?.slug).filter(Boolean) : [];

        if (!roleName) roleName = names[0] || dbUser.role || null;
        if (!rolesList) rolesList = names.length ? names : dbUser.role ? [dbUser.role] : null;
      }
    }

    // Build sanitized req.user (prefer DB where available)
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
      userObj.Roles = rolesList.map((name) => ({ name }));
    }

    req.user = userObj;
    return next();
  } catch (err) {
    console.error('Auth middleware error:', err);
    return res.status(500).json({ error: 'Authentication error' });
  }
}

/**
 * requireAuth
 *  - Strict guard. Use this on routes that must have an authenticated user even if
 *    you’re already running authenticateUser globally.
 */
function requireAuth(req, res, next) {
  if (!req.user?.id) return res.status(401).json({ error: 'Unauthorized' });
  return next();
}

/**
 * authorizeRoles(...roles)
 *  - Role-based guard (requires authenticateUser or requireAuth to have run)
 */
function authorizeRoles(...roles) {
  const allow = roles.map((r) => String(r).toLowerCase());
  return (req, res, next) => {
    const current = (req.user?.role || '').toLowerCase();
    if (!current) return res.status(401).json({ error: 'Unauthorized' });
    if (allow.length && !allow.includes(current)) {
      return res.status(403).json({ error: 'Access denied: insufficient role' });
    }
    next();
  };
}

module.exports = {
  authenticateUser,
  requireAuth,
  authorizeRoles,
};
