"use strict";

const { Permission, Role, User } = require("../models");

/* ------------------------------- helpers ---------------------------------- */

async function resolveUserRoleName(reqUser) {
  if (!reqUser) return null;
  if (typeof reqUser.role === "string" && reqUser.role.trim()) {
    return String(reqUser.role).toLowerCase();
  }
  if (Array.isArray(reqUser.Roles) && reqUser.Roles[0]?.name) {
    return String(reqUser.Roles[0].name).toLowerCase();
  }
  if (reqUser.id) {
    const dbUser = await User.findByPk(reqUser.id, {
      include: [{ model: Role, as: "Roles", attributes: ["name"], through: { attributes: [] } }],
      attributes: ["id"],
    });
    const name = dbUser?.Roles?.[0]?.name || null;
    if (name) return String(name).toLowerCase();
  }
  return null;
}

/** Check if an action matches a key (supports suffix wildcard: "module.sub.*"). */
function actionMatchesKey(action, key) {
  if (!action || !key) return false;
  if (action === key) return true;
  if (key.endsWith(".*")) {
    const prefix = key.slice(0, -2);
    return action.startsWith(prefix + ".");
  }
  return false;
}

/** Pick the most specific permission row for a given action (prefers exact). */
function pickPermissionForAction(perms, action) {
  let best = perms.find((p) => p.action === action);
  if (best) return best;
  const candidates = perms.filter(
    (p) => typeof p.action === "string" && p.action.endsWith(".*") && actionMatchesKey(action, p.action)
  );
  candidates.sort((a, b) => (b.action?.length || 0) - (a.action?.length || 0));
  return candidates[0] || null;
}

function normalizePermRoles(perm) {
  if (!perm) return [];
  const arr = Array.isArray(perm.roles) ? perm.roles : [];
  return arr.map((r) => String(r || "").toLowerCase()).filter(Boolean);
}

/* ------------------------------ main guards -------------------------------- */

/**
 * allow(action | action[], opts) -> middleware
 * Options:
 *   - mode: 'any' | 'all' (default: 'any')
 *   - defaultToAdmin: boolean (default: true) – if no row matches, allow for admin only
 * Also: system-level roles auto-bypass: system_admin, super_admin, owner, developer
 */
function allow(actionOrList, { mode = "any", defaultToAdmin = true } = {}) {
  return async (req, res, next) => {
    try {
      const user = req.user;
      if (!user) return res.status(401).json({ error: "Unauthorized" });

      const roleLc = await resolveUserRoleName(user);
      if (!roleLc) return res.status(403).json({ error: "Forbidden" });

      // Super roles bypass
      const SUPER = new Set(["system_admin", "super_admin", "owner", "developer"]);
      if (SUPER.has(roleLc)) return next();

      const actions = Array.isArray(actionOrList) ? actionOrList : [actionOrList];
      const wanted = actions.filter(Boolean).map(String);

      if (!req._permCache) {
        req._permCache = { all: await Permission.findAll() };
      }
      const perms = req._permCache.all || [];

      const results = wanted.map((act) => {
        const perm = pickPermissionForAction(perms, act);

        if (!perm) {
          // If there is no matching row, admin can pass by default
          return defaultToAdmin && roleLc === "admin";
        }

        const roles = normalizePermRoles(perm);
        return (
          roles.includes("*") ||
          roles.includes(roleLc) ||
          (roles.includes("admin") && roleLc === "admin")
        );
      });

      const ok = mode === "all" ? results.every(Boolean) : results.some(Boolean);
      if (!ok) return res.status(403).json({ error: "Forbidden" });

      return next();
    } catch (e) {
      console.error("allow() error:", e);
      return res.status(500).json({ error: "Permission check failed" });
    }
  };
}

/** Simple role gate without DB lookups. */
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
