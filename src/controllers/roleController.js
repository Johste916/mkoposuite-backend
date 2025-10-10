"use strict";

const db = require("../models");
const { Op } = require("sequelize");

const Role = db.Role;
const User = db.User;
const UserRole = db.UserRole || db.sequelize?.models?.UserRole;

// ---- helpers ----
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

/** GET /api/roles/:id/assignments */
exports.listAssignments = async (req, res) => {
  try {
    const role = await Role.findByPk(req.params.id);
    if (!role) return res.status(404).json({ error: "Role not found" });

    if (!UserRole) return res.json({ items: [], total: 0 });

    const { roleId, userId } = await detectUserRoleFields();

    const rows = await UserRole.findAll({
      attributes: [userId],
      where: { [roleId]: role.id },
      raw: true,
      limit: 10000,
    });

    const ids = rows.map((r) => r[userId]);
    if (!ids.length) return res.json({ items: [], total: 0 });

    const users = await User.findAll({
      where: { id: ids },
      attributes: ["id", "name", "email", "branchId", "role"],
    });

    res.json({ items: users, total: users.length });
  } catch (err) {
    console.error("listAssignments error:", err);
    res.status(500).json({ error: "Failed to list role assignments" });
  }
};

/** DELETE /api/roles/:id/assignments  — bulk unassign all users from this role */
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

/**
 * DELETE /api/roles/:id
 * - If role is assigned to users → 409 with assignedCount.
 * - Add `?force=1` to automatically detach from users then delete.
 * - System roles are protected unless you force.
 */
exports.deleteRole = async (req, res) => {
  try {
    const role = await Role.findByPk(req.params.id);
    if (!role) return res.status(404).json({ error: "Role not found" });
    if (role.isSystem) return res.status(403).json({ error: "System roles cannot be deleted" });

    const force = ["1", "true", "yes"].includes(String(req.query.force || "").toLowerCase());

    if (UserRole) {
      const { roleId } = await detectUserRoleFields();
      const assignedCount = await UserRole.count({ where: { [roleId]: role.id } });

      if (assignedCount > 0 && !force) {
        return res.status(409).json({
          error: "Role is assigned to users",
          assignedCount,
          hint: "Unassign from users (or call DELETE /api/roles/:id/assignments) or pass ?force=1 to delete anyway.",
        });
      }

      if (assignedCount > 0 && force) {
        await UserRole.destroy({ where: { [roleId]: role.id } });
      }
    }

    await role.destroy();
    res.json({ ok: true });
  } catch (err) {
    console.error("deleteRole error:", err);
    res.status(500).json({ error: "Failed to delete role" });
  }
};
