"use strict";

const db = require("../models");
const { Op } = require("sequelize");

const Role = db.Role;
const User = db.User;
const UserRole = db.UserRole || db.sequelize?.models?.UserRole;

/* ------------------------------ helpers ------------------------------ */
const safeString = (v) => (typeof v === "string" ? v : v == null ? "" : String(v));

/** Detect join-table column names (roleId vs role_id, userId vs user_id). */
async function detectUserRoleFields() {
  const defaults = { roleId: "roleId", userId: "userId" };
  try {
    const qi = db.sequelize.getQueryInterface();
    const desc = await qi.describeTable("UserRoles");
    const roleId = desc.roleId ? "roleId" : (desc.role_id ? "role_id" : defaults.roleId);
    const userId = desc.userId ? "userId" : (desc.user_id ? "user_id" : defaults.userId);
    return { roleId, userId };
  } catch {
    return defaults;
  }
}

/** Find which boolean/enum column represents "active" on User. */
function detectActiveColumn() {
  if (!User?.rawAttributes) return null;
  const candidates = ["isActive", "active", "enabled", "status"];
  for (const k of candidates) {
    if (User.rawAttributes[k]) return k;
  }
  return null;
}

/** Build a where clause for "active only", tolerant to different schemas. */
function buildActiveWhere(activeOnly) {
  if (!activeOnly) return {};
  const col = detectActiveColumn();
  if (!col) return {}; // If there's no active/status column, don't filter.
  // If column looks boolean, true/false works; if it’s a string status, prefer 'active'.
  const attr = User.rawAttributes[col];
  if (attr && (attr.type?.key === "BOOLEAN" || attr.type?.key === "TINYINT")) {
    return { [col]: true };
  }
  // Treat anything not 'disabled' or 'inactive' as active? Safer to require 'active'.
  return { [col]: "active" };
}

/** Count users attached to a role (activeOnly optional). Counts both join-table and legacy string column. */
async function countUsersWithRole(role, { activeOnly = false } = {}) {
  const activeWhere = buildActiveWhere(activeOnly);

  let count = 0;

  // 1) Count via join table if present
  if (UserRole) {
    const { roleId, userId } = await detectUserRoleFields();

    // When we need to filter for active users, join to Users and count distinct user ids.
    if (activeOnly) {
      const rows = await UserRole.findAll({
        attributes: [userId],
        where: { [roleId]: role.id },
        raw: true,
        limit: 10000,
      });
      const ids = rows.map(r => r[userId]);
      if (ids.length) {
        count += await User.count({
          where: { id: ids, ...activeWhere },
        });
      }
    } else {
      count += await UserRole.count({ where: { [roleId]: role.id } });
    }
  }

  // 2) Legacy: users whose single-string column `User.role` equals role.name
  if (User?.rawAttributes?.role) {
    const where = {
      role: role.name,
      ...(activeOnly ? activeWhere : {}),
    };
    count += await User.count({ where });
  }

  return count;
}

/* =============================== Controllers =============================== */

/** GET /api/roles */
exports.getAllRoles = async (_req, res) => {
  try {
    const roles = await Role.findAll({ order: [["name", "ASC"]] });
    res.json(roles);
  } catch (err) {
    console.error("getAllRoles error:", err);
    res.status(500).json({ error: "Failed to fetch roles" });
  }
};

/** GET /api/roles/:id */
exports.getRoleById = async (req, res) => {
  try {
    const role = await Role.findByPk(req.params.id);
    if (!role) return res.status(404).json({ error: "Role not found" });
    res.json(role);
  } catch (err) {
    console.error("getRoleById error:", err);
    res.status(500).json({ error: "Failed to fetch role" });
  }
};

/** POST /api/roles */
exports.createRole = async (req, res) => {
  try {
    const name = safeString(req.body?.name).trim();
    const description = safeString(req.body?.description).trim();

    if (!name || name.length < 2) {
      return res.status(400).json({ error: "Role name is required" });
    }

    const dupe = await Role.findOne({ where: { name } });
    if (dupe) return res.status(409).json({ error: "A role with this name already exists" });

    const role = await Role.create({ name, description, isSystem: false });
    res.status(201).json(role);
  } catch (err) {
    console.error("createRole error:", err);
    res.status(400).json({ error: "Failed to create role" });
  }
};

/** PUT /api/roles/:id */
exports.updateRole = async (req, res) => {
  try {
    const role = await Role.findByPk(req.params.id);
    if (!role) return res.status(404).json({ error: "Role not found" });
    if (role.isSystem) return res.status(403).json({ error: "System roles cannot be edited" });

    const name = req.body?.name != null ? safeString(req.body.name).trim() : undefined;
    const description = req.body?.description != null ? safeString(req.body.description).trim() : undefined;

    if (name && name !== role.name) {
      const dupe = await Role.findOne({ where: { name, id: { [Op.ne]: role.id } } });
      if (dupe) return res.status(409).json({ error: "Another role with this name already exists" });
    }

    await role.update({
      ...(typeof name !== "undefined" ? { name } : {}),
      ...(typeof description !== "undefined" ? { description } : {}),
    });

    res.json(role);
  } catch (err) {
    console.error("updateRole error:", err);
    res.status(500).json({ error: "Failed to update role" });
  }
};

/** GET /api/roles/:id/assignments  (?activeOnly=1) */
exports.listAssignments = async (req, res) => {
  try {
    const role = await Role.findByPk(req.params.id);
    if (!role) return res.status(404).json({ error: "Role not found" });

    const activeOnly = ["1", "true", "yes"].includes(String(req.query.activeOnly || "").toLowerCase());
    const activeWhere = buildActiveWhere(activeOnly);

    const users = new Map();

    // 1) Join-table assignments
    if (UserRole) {
      const { roleId, userId } = await detectUserRoleFields();
      const rows = await UserRole.findAll({
        attributes: [userId],
        where: { [roleId]: role.id },
        raw: true,
        limit: 10000,
      });
      const ids = rows.map(r => r[userId]);
      if (ids.length) {
        const found = await User.findAll({
          where: { id: ids, ...activeWhere },
          attributes: ["id", "name", "email", "branchId", "role"],
        });
        for (const u of found) users.set(u.id, u);
      }
    }

    // 2) Legacy `User.role` string
    if (User?.rawAttributes?.role) {
      const found = await User.findAll({
        where: { role: role.name, ...activeWhere },
        attributes: ["id", "name", "email", "branchId", "role"],
      });
      for (const u of found) users.set(u.id, u);
    }

    const items = Array.from(users.values());
    res.json({ items, total: items.length });
  } catch (err) {
    console.error("listAssignments error:", err);
    res.status(500).json({ error: "Failed to list role assignments" });
  }
};

/** DELETE /api/roles/:id/assignments  (bulk unassign all users from this role, legacy + join) */
exports.clearAssignments = async (req, res) => {
  try {
    const role = await Role.findByPk(req.params.id);
    if (!role) return res.status(404).json({ error: "Role not found" });

    let removed = 0;

    if (UserRole) {
      const { roleId } = await detectUserRoleFields();
      removed += await UserRole.destroy({ where: { [roleId]: role.id } });
    }

    if (User?.rawAttributes?.role) {
      removed += await User.update({ role: null }, { where: { role: role.name } }).then(r => r[0] || 0);
    }

    res.json({ ok: true, removed });
  } catch (err) {
    console.error("clearAssignments error:", err);
    res.status(500).json({ error: "Failed to clear role assignments" });
  }
};

/**
 * DELETE /api/roles/:id  (?force=1)
 * - Blocks only if attached to **active users**.
 * - If ?force=1, clears join-table rows and legacy user.role, then deletes.
 */
exports.deleteRole = async (req, res) => {
  try {
    const role = await Role.findByPk(req.params.id);
    if (!role) return res.status(404).json({ error: "Role not found" });
    if (role.isSystem) return res.status(403).json({ error: "System roles cannot be deleted" });

    const force = ["1", "true", "yes"].includes(String(req.query.force || "").toLowerCase());

    const assignedActive = await countUsersWithRole(role, { activeOnly: true });

    if (assignedActive > 0 && !force) {
      return res.status(409).json({
        error: "Role is assigned to active users",
        assignedActive,
        hint: "Unassign from users (or call DELETE /api/roles/:id/assignments) or pass ?force=1 to delete anyway.",
      });
    }

    if (force) {
      // Clear assignments (both join-table and legacy)
      if (UserRole) {
        const { roleId } = await detectUserRoleFields();
        await UserRole.destroy({ where: { [roleId]: role.id } });
      }
      if (User?.rawAttributes?.role) {
        await User.update({ role: null }, { where: { role: role.name } });
      }
    }

    await role.destroy();
    res.json({ ok: true });
  } catch (err) {
    console.error("deleteRole error:", err);
    res.status(500).json({ error: "Failed to delete role" });
  }
};
