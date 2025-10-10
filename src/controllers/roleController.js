"use strict";

const db = require("../models");
const { Op } = require("sequelize");

const Role = db.Role;
const User = db.User;
const UserRole = db.UserRole || db.sequelize?.models?.UserRole;

// ---------- small helpers ----------
const safeString = (v) => (typeof v === "string" ? v : v == null ? "" : String(v));

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

/** Try to find which "active" column your User model uses */
function resolveActiveColumn() {
  const attrs = (User && User.rawAttributes) || {};
  const candidates = ["isActive", "active", "enabled", "status"];
  for (const k of candidates) {
    if (attrs[k]) return k;
  }
  return null; // none found
}

/** Build a where clause to select only active users (or not) */
function buildActiveWhere(includeInactive) {
  const activeCol = resolveActiveColumn();
  if (!activeCol || includeInactive) return {}; // no filter if we can't detect or caller includes inactive
  // boolean-style or status-style columns
  if (["isActive", "active", "enabled"].includes(activeCol)) {
    return { [activeCol]: true };
  }
  if (activeCol === "status") {
    return { status: { [Op.in]: ["active", "enabled"] } };
  }
  return {};
}

/** Count assignments for existing users only; optionally only active users */
async function countAssignedUsers(roleId, { includeInactive = false } = {}) {
  if (!UserRole) return 0;
  const { roleId: roleKey, userId: userKey } = await detectUserRoleFields();

  // Join UserRoles -> Users; filter out orphaned rows automatically
  const whereUser = buildActiveWhere(includeInactive);
  const rows = await UserRole.findAll({
    where: { [roleKey]: roleId },
    attributes: [userKey],
    raw: true,
    limit: 10000,
  });

  const userIds = rows.map((r) => r[userKey]).filter(Boolean);
  if (userIds.length === 0) return 0;
  const existing = await User.count({
    where: { id: userIds, ...whereUser },
  });
  return existing;
}

/** List assigned users (existing; optionally only active) */
async function listAssignedUsers(roleId, { includeInactive = false } = {}) {
  if (!UserRole) return [];
  const { roleId: roleKey, userId: userKey } = await detectUserRoleFields();
  const whereUser = buildActiveWhere(includeInactive);

  const rows = await UserRole.findAll({
    where: { [roleKey]: roleId },
    attributes: [userKey],
    raw: true,
    limit: 10000,
  });

  const userIds = rows.map((r) => r[userKey]).filter(Boolean);
  if (userIds.length === 0) return [];

  const users = await User.findAll({
    where: { id: userIds, ...whereUser },
    attributes: ["id", "name", "email", "branchId", "role"],
  });
  return users;
}

// ---------- controllers ----------

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

/** GET /api/roles/:id/assignments
 *  Optional: ?includeInactive=1 — include inactive users too
 */
exports.listAssignments = async (req, res) => {
  try {
    const role = await Role.findByPk(req.params.id);
    if (!role) return res.status(404).json({ error: "Role not found" });

    const includeInactive = ["1", "true", "yes"].includes(String(req.query.includeInactive || "").toLowerCase());
    const users = await listAssignedUsers(role.id, { includeInactive });

    res.json({ items: users, total: users.length });
  } catch (err) {
    console.error("listAssignments error:", err);
    res.status(500).json({ error: "Failed to list role assignments" });
  }
};

/** DELETE /api/roles/:id/assignments  (bulk unassign all users from this role) */
exports.clearAssignments = async (req, res) => {
  try {
    const role = await Role.findByPk(req.params.id);
    if (!role) return res.status(404).json({ error: "Role not found" });
    if (!UserRole) return res.json({ ok: true, removed: 0 });

    const { roleId } = await detectUserRoleFields();
    const removed = await UserRole.destroy({ where: { [roleId]: role.id } });
    res.json({ ok: true, removed });
  } catch (err) {
    console.error("clearAssignments error:", err);
    res.status(500).json({ error: "Failed to clear role assignments" });
  }
};

/** DELETE /api/roles/:id  (?force=1, ?includeInactive=1)
 *  - Counts only existing + active users by default
 *  - includeInactive=1 -> also counts inactive users
 *  - force=1 -> destroys UserRole rows (for those users counted) before deleting role
 */
exports.deleteRole = async (req, res) => {
  try {
    const role = await Role.findByPk(req.params.id);
    if (!role) return res.status(404).json({ error: "Role not found" });
    if (role.isSystem) return res.status(403).json({ error: "System roles cannot be deleted" });

    const includeInactive = ["1", "true", "yes"].includes(String(req.query.includeInactive || "").toLowerCase());
    const force = ["1", "true", "yes"].includes(String(req.query.force || "").toLowerCase());

    const assignedCount = await countAssignedUsers(role.id, { includeInactive });

    if (assignedCount > 0 && !force) {
      return res.status(409).json({
        error: includeInactive
          ? "Role is assigned to users (including inactive)."
          : "Role is assigned to active users.",
        assignedCount,
        hint: includeInactive
          ? "Unassign from users (or call DELETE /api/roles/:id/assignments) or pass ?force=1 to delete anyway."
          : "Unassign from active users (or pass ?force=1) to delete.",
      });
    }

    // If forced, remove only rows that belong to *existing* users we counted
    if (assignedCount > 0 && force && UserRole) {
      const { roleId: roleKey, userId: userKey } = await detectUserRoleFields();
      const users = await listAssignedUsers(role.id, { includeInactive });
      const ids = users.map(u => u.id);
      if (ids.length) {
        await UserRole.destroy({ where: { [roleKey]: role.id, [userKey]: ids } });
      }
    }

    await role.destroy();
    res.json({ ok: true });
  } catch (err) {
    console.error("deleteRole error:", err);
    res.status(500).json({ error: "Failed to delete role" });
  }
};
