// backend/src/middleware/authMiddleware.js
const jwt = require('jsonwebtoken');
const { User, Role } = require('../models');

// Extract "Bearer <token>" safely (case-insensitive)
function getBearerToken(header) {
  if (!header) return null;
  const [scheme, token] = String(header).split(' ');
  if (!/^Bearer$/i.test(scheme) || !token) return null;
  return token.trim();
}

/**
 * Authenticate request and enrich req.user:
 * - Normalize user id from id|userId|uid|sub
 * - If role is missing, load User + Roles from DB (alias 'Roles') and attach:
 *    req.user.role = '<first role name>'
 *    req.user.Roles = [{ name: 'roleA' }, ...]
 */
async function authenticateUser(req, res, next) {
  try {
    const token = getBearerToken(req.headers.authorization);
    if (!token) return res.status(401).json({ error: 'Missing Authorization token' });

    const secret = process.env.JWT_SECRET || process.env.JWT_KEY;
    if (!secret) {
      console.error('JWT secret is not set (JWT_SECRET or JWT_KEY).');
      return res.status(500).json({ error: 'Server misconfigured: JWT secret missing' });
    }

    let payload;
    try {
      payload = jwt.verify(token, secret);
    } catch (e) {
      console.warn('JWT verify failed:', e.message);
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    // Normalize possible id fields from various issuers
    const normalizedId = payload.id ?? payload.userId ?? payload.uid ?? payload.sub ?? null;

    // Start with what the token gave us
    let roleName = payload.role || null;
    let rolesList =
      (Array.isArray(payload.Roles) && payload.Roles.map(r => r?.name).filter(Boolean)) ||
      (Array.isArray(payload.roles) && payload.roles.map(String)) ||
      null;

    // Enrich from DB if needed
    if ((!roleName || !rolesList) && normalizedId && User && Role) {
      try {
        const dbUser = await User.findByPk(normalizedId, {
          include: [{ model: Role, as: 'Roles', attributes: ['name'], through: { attributes: [] } }],
          attributes: ['id', 'email', 'username', 'name', 'fullName'],
        });
        if (dbUser) {
          const names = (dbUser.Roles || []).map(r => r.name);
          if (!roleName && names.length) roleName = names[0];
          if (!rolesList) rolesList = names;
        }
      } catch (e) {
        console.warn('authMiddleware: failed to enrich user from DB:', e.message);
      }
    }

    // Rebuild a clean req.user object
    req.user = {
      ...payload,
      id: normalizedId ?? payload.id,
      role: roleName || payload.role || null,
      // Keep Roles both as names and objects to satisfy downstream code
      roles: Array.isArray(rolesList) ? rolesList : undefined,
      Roles: Array.isArray(rolesList) ? rolesList.map(name => ({ name })) : payload.Roles,
    };

    return next();
  } catch (err) {
    console.error('Auth middleware error:', err);
    return res.status(500).json({ error: 'Authentication error' });
  }
}

// Role-based guard (use AFTER authenticateUser)
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
  authorizeRoles,
};
