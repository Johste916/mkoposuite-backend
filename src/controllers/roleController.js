"use strict";

const db = require("../models");
const { Op } = require("sequelize");

const Role = db.Role;
const UserRole =
  db.UserRole ||
  db.UserRoles ||
  (db.sequelize?.models && db.sequelize.models.UserRole);

const safeString = (v) => (typeof v === "string" ? v : v == null ? "" : String(v));

/** tiny helper: detect the actual roleId column in UserRoles */
async function detectUserRoleRoleIdField() {
  try {
    const qi = db.sequelize.getQueryInterface();
    const desc = await qi.describeTable("UserRoles");
    if (desc.roleId) return "roleId";
    if (desc.role_id) return "role_id";
  } catch (_) {}
  // fallback to attribute names if available
  if (UserRole?.rawAttributes?.roleId) return "roleId";
  if (UserRole?.rawAttributes?.role_id) return "role_id";
  return "roleId"; // sane default
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

/** POST /api/roles  body: { name, description } */
exports.createRole = async (req, res) => {
  try {
    const name = safeString(req.body?.name).trim();
    const description = safeString(req.body?.description).trim();

    if (!name || name.length < 2) {
      return res.status(400).json({ error: "Role name is required" });
    }

    const dupe = await Role.findOne({ where: { name } });
    if (dupe) {
      return res.status(409).json({ error: "A role with this name already exists" });
    }

    const role = await Role.create({ name, description, isSystem: false });
    res.status(201).json(role);
  } catch (err) {
    console.error("createRole error:", err);
    res.status(400).json({ error: "Failed to create role" });
  }
};

/** PUT /api/roles/:id  body: { name?, description? } */
exports.updateRole = async (req, res) => {
  try {
    const role = await Role.findByPk(req.params.id);
    if (!role) return res.status(404).json({ error: "Role not found" });
    if (role.isSystem) return res.status(403).json({ error: "System roles cannot be edited" });

    const nextName = req.body?.name != null ? safeString(req.body.name).trim() : undefined;
    const nextDesc = req.body?.description != null ? safeString(req.body.description).trim() : undefined;

    if (nextName && nextName !== role.name) {
      const dupe = await Role.findOne({ where: { name: nextName, id: { [Op.ne]: role.id } } });
      if (dupe) return res.status(409).json({ error: "Another role with this name already exists" });
    }

    await role.update({
      ...(typeof nextName !== "undefined" ? { name: nextName } : {}),
      ...(typeof nextDesc !== "undefined" ? { description: nextDesc } : {}),
    });

    res.json(role);
  } catch (err) {
    console.error("updateRole error:", err);
    res.status(500).json({ error: "Failed to update role" });
  }
};

/** DELETE /api/roles/:id  (?force=1 to remove even if assigned) */
exports.deleteRole = async (req, res) => {
  try {
    const role = await Role.findByPk(req.params.id);
    if (!role) return res.status(404).json({ error: "Role not found" });
    if (role.isSystem) return res.status(403).json({ error: "System roles cannot be deleted" });

    const force = ["1", "true", "yes"].includes(String(req.query.force || "").toLowerCase());

    if (UserRole) {
      const roleIdField = await detectUserRoleRoleIdField();

      // Count assignments robustly across environments
      const assignedCount = await UserRole.count({ where: { [roleIdField]: role.id } });

      if (assignedCount > 0 && !force) {
        return res.status(409).json({
          error: "Role is assigned to users",
          assignedCount,
          hint: "Unassign from users or pass ?force=1 to delete anyway.",
        });
      }
      if (assignedCount > 0 && force) {
        await UserRole.destroy({ where: { [roleIdField]: role.id } });
      }
    }

    await role.destroy();
    res.json({ ok: true });
  } catch (err) {
    console.error("deleteRole error:", err);
    res.status(500).json({ error: "Failed to delete role" });
  }
};
