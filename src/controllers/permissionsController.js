"use strict";

const { Op } = require("sequelize");
const { Permission, Role } = require("../models");
const CATALOG = require("../permissions/catalog");

const safeString = v => (typeof v === "string" ? v : v == null ? "" : String(v).trim());

async function ensureCatalogRows() {
  const actions = [];
  for (const g of CATALOG) for (const a of g.actions) actions.push({ key: a.key, label: a.label });

  const existing = await Permission.findAll({ where: { action: { [Op.in]: actions.map(a => a.key) } } });
  const existingSet = new Set(existing.map((p) => p.action));

  const toCreate = actions.filter(a => !existingSet.has(a.key));
  if (toCreate.length) {
    await Permission.bulkCreate(
      toCreate.map(a => ({
        action: a.key,
        description: a.label,
        roles: [],
        isSystem: true,
      })),
      { ignoreDuplicates: true }
    );
  }

  // backfill empty descriptions only
  for (const a of actions) {
    await Permission.update(
      { description: a.label },
      { where: { action: a.key, [Op.or]: [{ description: null }, { description: "" }] } }
    ).catch(() => {});
  }
}

/* --------------------------- Legacy / Utility CRUD ------------------------- */

// GET /api/permissions
exports.getPermissions = async (_req, res) => {
  try {
    await ensureCatalogRows();
    const rows = await Permission.findAll({ order: [["action", "ASC"]] });
    res.json(rows);
  } catch (err) {
    console.error("getPermissions error:", err);
    res.status(500).json({ error: "Failed to fetch permissions" });
  }
};

// PUT /api/permissions/:action
exports.updatePermission = async (req, res) => {
  try {
    const action = safeString(req.params.action);
    const roles = Array.isArray(req.body?.roles) ? req.body.roles.map(String) : null;
    const description = safeString(req.body?.description);

    if (!action) return res.status(400).json({ error: "Invalid action" });
    if (!roles) return res.status(400).json({ error: "roles must be an array" });

    await ensureCatalogRows();

    const [row] = await Permission.findOrCreate({
      where: { action },
      defaults: { action, description: description || action, roles: [] },
    });
    row.roles = roles;
    if (description) row.description = description;
    await row.save();

    res.json({ message: `Saved "${action}"`, permission: row });
  } catch (err) {
    console.error("updatePermission error:", err);
    res.status(500).json({ error: "Failed to update permission" });
  }
};

// POST /api/permissions
exports.createPermission = async (req, res) => {
  try {
    const name = safeString(req.body?.name);
    if (!name) return res.status(400).json({ error: "name required" });
    const [row, created] = await Permission.findOrCreate({
      where: { action: name },
      defaults: { action: name, roles: [], description: name },
    });
    if (!created) return res.status(409).json({ error: "Permission already exists" });
    res.status(201).json(row);
  } catch (e) {
    console.error("createPermission error:", e);
    res.status(500).json({ error: "Failed to create permission" });
  }
};

// DELETE /api/permissions/:id
exports.deletePermission = async (req, res) => {
  try {
    await Permission.destroy({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (e) {
    console.error("deletePermission error:", e);
    res.status(500).json({ error: "Failed to delete permission" });
  }
};

/* ----------------------------- Role utilities ------------------------------ */

// GET /api/permissions/role/:roleId  (when routed to permsCtl.getRolePermissions)
exports.getRolePermissions = async (req, res) => {
  try {
    const roleId = safeString(req.params.roleId);
    const role = await Role.findByPk(roleId);
    if (!role) return res.status(404).json({ error: "Role not found" });

    await ensureCatalogRows();

    const rows = await Permission.findAll();
    const actions = rows
      .filter(p => (p.roles || []).map(String).includes(role.name))
      .map(p => p.action);

    res.json({ role: { id: role.id, name: role.name }, actions });
  } catch (e) {
    console.error("getRolePermissions error:", e);
    res.status(500).json({ error: "Failed to fetch role permissions" });
  }
};
