// backend/src/services/permissionService.js
"use strict";

const { User, Role, Permission } = require("../models");

/**
 * Return all permission action keys for a given userId
 * by resolving their roles and Permission table mappings.
 */
async function getPermissionsForUser(userId) {
  const user = await User.findByPk(userId, {
    include: [{ model: Role, as: "Roles", through: { attributes: [] } }],
  });
  if (!user) return [];

  const roles = (user.Roles || []).map((r) => String(r.name).toLowerCase());
  const rows = await Permission.findAll({ attributes: ["action", "roles"], raw: true });

  const allowed = rows.filter((r) =>
    (r.roles || []).some((x) => roles.includes(String(x).toLowerCase()))
  );

  return allowed.map((r) => r.action);
}

module.exports = { getPermissionsForUser };
