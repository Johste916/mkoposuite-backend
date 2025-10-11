// backend/src/middleware/permissions.js
"use strict";

const { Permission, Role, User } = require("../models");

/* ------------------------------- helpers ---------------------------------- */

/** Return a lowercased primary role name for the current user (best-effort). */
async function resolveUserRoleName(reqUser) {
  if (!reqUser) return null;

  // 1) Plain string role on the token/user object
  if (typeof reqUser.role === "string" && reqUser.role.trim()) {
    return String(reqUser.role).toLowerCase();
  }

  // 2) First associated role already attached on request
  if (Array.isArray(reqUser.Roles) && reqUser.Roles[0]?.name) {
    return String(reqUser.Roles[0].name).toLowerCase();
  }

  // 3) Load roles via DB if we have an id and no role yet
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
  // Exact match first
  let best = perms.find((p) => p.action === action);
  if (best) return best;

  // Then the longest matching wildcard
  const candidates = perms.filter((p) => typeof p.action === "string" && p.action.endsWith(".*") && actionMatchesKey(action, p.action));
  candidates.sort((a, b) => (b.action?.length || 0) - (a.action?.length || 0));
  return candidates[0] || null;
}

/** Normalize roles array on a permission row to lower-case strings. */
function normalizePermRoles(perm) {
  if (!perm) return [];
  const arr = Array.isArray(perm.roles) ? perm.roles : [];
  return arr.map((r) => String(r || "").toLowerCase()).filter(Boolean);
}

/* ------------------------------ main guards -------------------------------- */

/**
 * allow(action | action[], opts) -> middleware
 *
 * Options:
 *   - mode: 'any' | 'all' (when passing an array of actions). Default: 'any'
 *   - defaultToAdmin: boolean. If no Permission row matches an action, allow only admin by default (true).
 *
 * Examples:
 *   router.get('/loans', allow('loans.view'), handler)
 *   router.post('/loans/apply', allow(['loans.apply', 'loans.view'], { mode: 'all' }), handler)
 */
function allow(actionOrList, { mode = "any", defaultToAdmin = true } = {}) {
  return async (req, res, next) => {
    try {
      const user = req.user;
      if (!user) return res.status(401).json({ error: "Unauthorized" });

      const roleLc = await resolveUserRoleName(user);
      if (!roleLc) return res.status(403).json({ error: "Forbidden" });

      // Normalize actions array
      const actions = Array.isArray(actionOrList) ? actionOrList : [actionOrList];
      const wanted = actions.filter(Boolean).map(String);

      // Per-request cache to avoid duplicate Permission queries
      if (!req._permCache) {
        req._permCache = {
          all: await Permission.findAll(), // one read per request
        };
      }
      const perms = req._permCache.all || [];

      // Evaluate each action
      const results = wanted.map((act) => {
        const perm = pickPermissionForAction(perms, act);

        // No row matched this action: admin-only if defaultToAdmin
        if (!perm) {
          return defaultToAdmin && roleLc === "admin";
        }

        const roles = normalizePermRoles(perm);
        return roles.includes("*") || roles.includes(roleLc) || (roles.includes("admin") && roleLc === "admin");
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

/**
 * Simple role gate without hitting DB.
 * Usage: router.get('/admin', requireRole(['admin', 'director']), handler)
 */
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
