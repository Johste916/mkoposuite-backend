// backend/src/middleware/permissions.js
const { Permission, Role, User } = require('../models');

/**
 * allow('actionName') -> middleware that checks whether the current user's role
 * is allowed for the given action (based on Permission table).
 *
 * Notes:
 * - Accepts role from req.user.role (string), or from req.user.Roles[0].name,
 *   or loads Roles via a JOIN if not present on the request.
 * - Case-insensitive comparison of role names.
 * - If no Permission row exists for an action, we ALLOW 'admin' by default (secure-but-practical).
 */
function allow(action, { defaultToAdmin = true } = {}) {
  return async (req, res, next) => {
    try {
      const u = req.user;
      if (!u) return res.status(401).json({ error: 'Unauthorized' });

      // 1) Resolve user's role name reliably
      let roleName =
        (typeof u.role === 'string' && u.role) ||
        (Array.isArray(u.Roles) && u.Roles[0] && u.Roles[0].name) ||
        null;

      if (!roleName && u.id) {
        // Load user + Roles from DB (association alias in your models is 'Roles')
        const dbUser = await User.findByPk(u.id, {
          include: [{ model: Role, as: 'Roles', attributes: ['name'], through: { attributes: [] } }],
          attributes: ['id'],
        });
        roleName = dbUser?.Roles?.[0]?.name || null;
      }

      if (!roleName) return res.status(403).json({ error: 'Forbidden' });

      const roleNameLc = String(roleName).toLowerCase();

      // 2) Fetch permission record for this action
      const perm = await Permission.findOne({ where: { action } });

      if (!perm) {
        // If there is no row yet, allow admins only (so you don't lock yourself out)
        if (defaultToAdmin && roleNameLc === 'admin') return next();
        return res.status(403).json({ error: 'Forbidden' });
      }

      // 3) Roles array check (case-insensitive)
      const roles = Array.isArray(perm.roles) ? perm.roles.map((r) => String(r).toLowerCase()) : [];

      // Support small conveniences
      const whitelisted =
        roles.includes(roleNameLc) ||
        roles.includes('*') ||               // wildcard
        (roles.includes('admin') && roleNameLc === 'admin');

      if (!whitelisted) return res.status(403).json({ error: 'Forbidden' });

      next();
    } catch (e) {
      console.error('allow() error:', e);
      res.status(500).json({ error: 'Permission check failed' });
    }
  };
}

module.exports = { allow };
