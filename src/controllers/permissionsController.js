// backend/src/controllers/permissionsController.js
"use strict";

const { Op } = require("sequelize");
const { Permission, Role } = require("../models");

// ---- Catalog: list all features/actions you want to govern ----
// You can expand/rename freely. These keys are what you'll check in `allow("<action>")`.
const PERMISSION_CATALOG = [
  {
    group: "Users & Staff",
    actions: [
      { action: "staff.view",    label: "View staff",    verbs: ["view"] },
      { action: "staff.create",  label: "Create staff",  verbs: ["create"] },
      { action: "staff.update",  label: "Update staff",  verbs: ["update"] },
      { action: "staff.delete",  label: "Delete staff",  verbs: ["delete"] },
      { action: "roles.view",    label: "View roles",    verbs: ["view"] },
      { action: "roles.manage",  label: "Manage roles",  verbs: ["create","update","delete"] },
      { action: "permissions.manage", label: "Manage permissions", verbs: ["update"] },
    ],
  },
  {
    group: "Loans",
    actions: [
      { action: "loans.view",    label: "View loans",    verbs: ["view"] },
      { action: "loans.create",  label: "Create loans",  verbs: ["create"] },
      { action: "loans.update",  label: "Update loans",  verbs: ["update"] },
      { action: "loans.approve", label: "Approve loans", verbs: ["approve"] },
      { action: "repayments.createManual", label: "Create manual repayment", verbs: ["create"] },
    ],
  },
  {
    group: "Accounting",
    actions: [
      { action: "accounting.view",   label: "View accounting",  verbs: ["view"] },
      { action: "accounting.post",   label: "Post entries",     verbs: ["create"] },
    ],
  },
  {
    group: "Branches",
    actions: [
      { action: "branches.view",   label: "View branches",   verbs: ["view"] },
      { action: "branches.create", label: "Create branches", verbs: ["create"] },
      { action: "branches.update", label: "Update branches", verbs: ["update"] },
      { action: "branches.delete", label: "Delete branches", verbs: ["delete"] },
    ],
  },
  {
    group: "SMS",
    actions: [
      { action: "sms.send",      label: "Send SMS",     verbs: ["create"] },
      { action: "sms.viewLogs",  label: "View SMS logs", verbs: ["view"] },
    ],
  },
  {
    group: "Reports",
    actions: [
      { action: "reports.view", label: "View reports", verbs: ["view"] },
    ],
  },
  {
    group: "Settings",
    actions: [
      { action: "settings.manage", label: "Manage settings", verbs: ["update"] },
    ],
  },
];

// ---------- helpers ----------
const safeString = v => (typeof v === "string" ? v : v == null ? "" : String(v).trim());
const asLower = a => (Array.isArray(a) ? a.map(x => String(x).toLowerCase()) : []);

async function ensurePermissionRow(action, description = "") {
  const [row] = await Permission.findOrCreate({
    where: { action },
    defaults: { action, description, roles: [] },
  });
  return row;
}

// ---------- basic list ----------
exports.getPermissions = async (_req, res) => {
  try {
    const rows = await Permission.findAll({ order: [["action", "ASC"]] });
    res.json(rows);
  } catch (err) {
    console.error("getPermissions error:", err);
    res.status(500).json({ error: "Failed to fetch permissions" });
  }
};

// ---------- upsert add/update one ----------
exports.updatePermission = async (req, res) => {
  try {
    const action = safeString(req.params.action);
    const roles = Array.isArray(req.body?.roles) ? req.body.roles.map(String) : null;
    const description = safeString(req.body?.description);

    if (!action) return res.status(400).json({ error: "Invalid action" });
    if (!roles) return res.status(400).json({ error: "roles must be an array" });

    const row = await ensurePermissionRow(action, description);
    row.roles = roles;
    if (description) row.description = description;
    await row.save();

    res.json({ message: `Saved "${action}"`, permission: row });
  } catch (err) {
    console.error("updatePermission error:", err);
    res.status(500).json({ error: "Failed to update permission" });
  }
};

// ---------- create & delete plain rows (optional) ----------
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

exports.deletePermission = async (req, res) => {
  try {
    await Permission.destroy({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (e) {
    console.error("deletePermission error:", e);
    res.status(500).json({ error: "Failed to delete permission" });
  }
};

// ---------- matrix: grouped actions + roles ----------
exports.getMatrix = async (_req, res) => {
  try {
    // ensure catalog rows exist
    for (const g of PERMISSION_CATALOG) {
      for (const a of g.actions) await ensurePermissionRow(a.action, a.label);
    }

    const roles = await Role.findAll({ order: [["name", "ASC"]] });
    const perms = await Permission.findAll();

    const byAction = new Map(perms.map(p => [p.action, p]));
    const matrix = PERMISSION_CATALOG.map(group => ({
      group: group.group,
      actions: group.actions.map(a => ({
        action: a.action,
        label: a.label,
        verbs: a.verbs,
        roles: (byAction.get(a.action)?.roles || []), // array of role names
      })),
    }));

    res.json({ roles, matrix });
  } catch (e) {
    console.error("getMatrix error:", e);
    res.status(500).json({ error: "Failed to load permission matrix" });
  }
};

// ---------- set permissions for one role (replace/add/remove) ----------
exports.setRolePermissions = async (req, res) => {
  try {
    const roleId = safeString(req.params.roleId);
    const role = await Role.findByPk(roleId);
    if (!role) return res.status(404).json({ error: "Role not found" });

    const actions = Array.isArray(req.body?.actions) ? req.body.actions.map(safeString) : null;
    const mode = safeString(req.body?.mode || "replace"); // replace | add | remove
    if (!actions) return res.status(400).json({ error: "actions must be an array of action strings" });

    // make sure all actions exist
    for (const a of actions) await ensurePermissionRow(a);

    const allPerms = await Permission.findAll({
      where: { action: { [Op.in]: actions } },
    });

    if (mode === "replace") {
      // remove role from ALL actions first, then add to specified ones
      const everyPerm = await Permission.findAll();
      await Promise.all(
        everyPerm.map(async (p) => {
          const set = new Set(asLower(p.roles));
          set.delete(role.name.toLowerCase());
          p.roles = Array.from(set);
          await p.save();
        })
      );
      // then add to actions
      for (const p of allPerms) {
        const set = new Set(asLower(p.roles));
        set.add(role.name.toLowerCase());
        p.roles = Array.from(set);
        await p.save();
      }
    } else if (mode === "add") {
      for (const p of allPerms) {
        const set = new Set(asLower(p.roles));
        set.add(role.name.toLowerCase());
        p.roles = Array.from(set);
        await p.save();
      }
    } else if (mode === "remove") {
      for (const p of allPerms) {
        const set = new Set(asLower(p.roles));
        set.delete(role.name.toLowerCase());
        p.roles = Array.from(set);
        await p.save();
      }
    } else {
      return res.status(400).json({ error: "Invalid mode" });
    }

    res.json({ ok: true });
  } catch (e) {
    console.error("setRolePermissions error:", e);
    res.status(500).json({ error: "Failed to save role permissions" });
  }
};

// ---------- get actions for a role ----------
exports.getRolePermissions = async (req, res) => {
  try {
    const roleId = safeString(req.params.roleId);
    const role = await Role.findByPk(roleId);
    if (!role) return res.status(404).json({ error: "Role not found" });

    const rows = await Permission.findAll();
    const a = rows
      .filter(p => asLower(p.roles).includes(role.name.toLowerCase()))
      .map(p => p.action);

    res.json({ role: { id: role.id, name: role.name }, actions: a });
  } catch (e) {
    console.error("getRolePermissions error:", e);
    res.status(500).json({ error: "Failed to fetch role permissions" });
  }
};
