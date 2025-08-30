// backend/src/middleware/permissions.js
const { Permission, Role, User } = require("../models");

/**
 * allow('actionName') -> middleware that checks whether current user's role
 * is allowed for the given action (based on Permission table).
 *
 * - Accepts role from req.user.role (string), req.user.Roles[0].name,
 *   or loads Roles via a JOIN if not present on the request.
 * - Case-insensitive role matching; supports wildcard '*' in Permission.roles.
 * - If no Permission row exists for an action, default allow for 'admin' only.
 */
function allow(action, { defaultToAdmin = true } = {}) {
  return async (req, res, next) => {
    try {
      const u = req.user;
      if (!u) return res.status(401).json({ error: "Unauthorized" });

      let roleName =
        (typeof u.role === "string" && u.role) ||
        (Array.isArray(u.Roles) && u.Roles[0]?.name) ||
        null;

      if (!roleName && u.id) {
        const dbUser = await User.findByPk(u.id, {
          include: [{ model: Role, as: "Roles", attributes: ["name"], through: { attributes: [] } }],
          attributes: ["id"],
        });
        roleName = dbUser?.Roles?.[0]?.name || null;
      }
      if (!roleName) return res.status(403).json({ error: "Forbidden" });

      const roleLc = String(roleName).toLowerCase();
      const perm = await Permission.findOne({ where: { action } });

      if (!perm) {
        if (defaultToAdmin && roleLc === "admin") return next();
        return res.status(403).json({ error: "Forbidden" });
      }

      const roles = Array.isArray(perm.roles) ? perm.roles.map((r) => String(r).toLowerCase()) : [];
      const ok = roles.includes("*") || roles.includes(roleLc) || (roles.includes("admin") && roleLc === "admin");

      if (!ok) return res.status(403).json({ error: "Forbidden" });
      next();
    } catch (e) {
      console.error("allow() error:", e);
      res.status(500).json({ error: "Permission check failed" });
    }
  };
}

/** Simple role gate without hitting DB (useful for route-level quick checks). */
function requireRole(allowed = []) {
  const set = new Set(allowed.map((r) => String(r).toLowerCase()));
  return (req, res, next) => {
    const role =
      (req.user && typeof req.user.role === "string" && req.user.role) ||
      (Array.isArray(req.user?.Roles) && req.user.Roles[0]?.name) ||
      "";
    if (set.has(String(role).toLowerCase()) || set.has("*")) return next();
    return res.status(403).json({ error: "Forbidden" });
  };
}

module.exports = { allow, requireRole };
