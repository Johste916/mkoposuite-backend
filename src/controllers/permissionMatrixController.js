// backend/src/controllers/permissionMatrixController.js
"use strict";

const { sequelize, Permission, Role } = require("../models");

/**
 * Canonical list of features -> actions we want to show in the matrix UI.
 * Feel free to extend/rename to match your app.
 */
const REGISTRY = [
  {
    group: "Staff & Users",
    actions: [
      { action: "staff.view",     label: "View staff",     verbs: ["read"] },
      { action: "staff.create",   label: "Create staff",   verbs: ["create"] },
      { action: "staff.update",   label: "Update staff",   verbs: ["update"] },
      { action: "staff.delete",   label: "Delete staff",   verbs: ["delete"] },
      { action: "staff.assign",   label: "Assign roles/branches", verbs: ["update"] },
    ],
  },
  {
    group: "Borrowers",
    actions: [
      { action: "borrowers.view",   label: "View borrowers",   verbs: ["read"] },
      { action: "borrowers.create", label: "Create borrower",  verbs: ["create"] },
      { action: "borrowers.update", label: "Update borrower",  verbs: ["update"] },
      { action: "borrowers.delete", label: "Delete borrower",  verbs: ["delete"] },
    ],
  },
  {
    group: "Loans",
    actions: [
      { action: "loans.view",    label: "View loans",    verbs: ["read"] },
      { action: "loans.create",  label: "Create loan",   verbs: ["create"] },
      { action: "loans.update",  label: "Update loan",   verbs: ["update"] },
      { action: "loans.approve", label: "Approve loan",  verbs: ["approve"] },
      { action: "loans.disburse",label: "Disburse loan", verbs: ["disburse"] },
      { action: "loans.writeoff",label: "Write-off",     verbs: ["writeoff"] },
    ],
  },
  {
    group: "Repayments & Collections",
    actions: [
      { action: "repayments.createManual", label: "Post manual repayment", verbs: ["create"] },
      { action: "collections.view",        label: "View collections",      verbs: ["read"] },
    ],
  },
  {
    group: "Savings",
    actions: [
      { action: "savings.view",   label: "View savings",   verbs: ["read"] },
      { action: "savings.post",   label: "Post deposit",   verbs: ["create"] },
      { action: "savings.withdraw",label: "Withdraw",      verbs: ["create"] },
    ],
  },
  {
    group: "Accounting",
    actions: [
      { action: "accounting.view",   label: "View accounting",   verbs: ["read"] },
      { action: "accounting.journal",label: "Post journal",      verbs: ["create"] },
      { action: "accounting.close",  label: "Close period",      verbs: ["update"] },
    ],
  },
  {
    group: "Branches & Org",
    actions: [
      { action: "branches.view",  label: "View branches",  verbs: ["read"] },
      { action: "branches.edit",  label: "Edit branches",  verbs: ["update"] },
      { action: "org.settings",   label: "Manage settings",verbs: ["update"] },
    ],
  },
  {
    group: "Messaging",
    actions: [
      { action: "sms.send",   label: "Send SMS",     verbs: ["create"] },
      { action: "sms.view",   label: "View SMS logs",verbs: ["read"] },
    ],
  },
  {
    group: "Reports",
    actions: [
      { action: "reports.view", label: "View reports", verbs: ["read"] },
    ],
  },
];

/** Merge DB permissions (existing actions + role lists) into the registry. */
async function buildMatrix() {
  const rows = await Permission.findAll({ order: [["action", "ASC"]] });

  // Map action -> roles[] from DB
  const roleByAction = new Map();
  for (const p of rows) {
    roleByAction.set(p.action, Array.isArray(p.roles) ? p.roles : []);
  }

  // Also add "orphan" actions that exist in DB but not in our registry (so they still show up)
  const extra = [];
  for (const p of rows) {
    const inRegistry = REGISTRY.some((g) => g.actions.some((a) => a.action === p.action));
    if (!inRegistry) {
      extra.push({ action: p.action, label: p.action, verbs: [] });
    }
  }

  const registry = REGISTRY.map((g) => ({
    group: g.group,
    actions: g.actions.map((a) => ({ ...a, roles: roleByAction.get(a.action) || [] })),
  }));

  if (extra.length) {
    registry.push({
      group: "Other",
      actions: extra.map((a) => ({ ...a, roles: roleByAction.get(a.action) || [] })),
    });
  }

  return registry;
}

/** GET /api/permissions/matrix */
exports.getMatrix = async (_req, res) => {
  try {
    const roles = await Role.findAll({ attributes: ["id", "name"], order: [["name", "ASC"]] });
    const matrix = await buildMatrix();
    res.json({ roles, matrix });
  } catch (e) {
    console.error("getMatrix error:", e);
    res.status(500).json({ error: "Failed to load permission matrix" });
  }
};

/**
 * PUT /api/permissions/role/:roleId
 * body: { actions: string[], mode?: "replace" | "merge" }
 * Updates the Permission.roles arrays so that the provided role has exactly (replace)
 * or at least (merge) the listed actions.
 */
exports.saveForRole = async (req, res) => {
  const { roleId } = req.params;
  const actions = Array.isArray(req.body?.actions) ? req.body.actions.map(String) : [];
  const mode = (req.body?.mode || "replace").toLowerCase();

  if (!roleId) return res.status(400).json({ error: "roleId required" });

  const t = await sequelize.transaction();
  try {
    const role = await Role.findByPk(roleId, { transaction: t });
    if (!role) { await t.rollback(); return res.status(404).json({ error: "Role not found" }); }
    const roleName = role.name;

    const dbPerms = await Permission.findAll({ transaction: t });

    // Helper to persist a Permission row’s roles array
    const saveRoles = async (p, newRoles) => {
      const clean = Array.from(new Set(newRoles.map((r) => String(r))));
      await p.update({ roles: clean }, { transaction: t });
    };

    /** 1) Ensure rows exist for each requested action; grant role on them. */
    for (const action of actions) {
      let p = dbPerms.find((x) => x.action === action);
      if (!p) {
        p = await Permission.create(
          { action, roles: [roleName], description: action, isSystem: false },
          { transaction: t }
        );
        dbPerms.push(p);
      } else {
        const set = new Set(Array.isArray(p.roles) ? p.roles : []);
        set.add(roleName);
        await saveRoles(p, Array.from(set));
      }
    }

    /** 2) If replace mode, remove role from any action NOT in the list. */
    if (mode === "replace") {
      for (const p of dbPerms) {
        if (!actions.includes(p.action)) {
          const set = new Set(Array.isArray(p.roles) ? p.roles : []);
          if (set.delete(roleName)) {
            await saveRoles(p, Array.from(set));
          }
        }
      }
    }

    await t.commit();
    res.json({ ok: true, roleId, actions, mode });
  } catch (e) {
    await t.rollback();
    console.error("saveForRole error:", e);
    res.status(500).json({ error: "Failed to save role permissions" });
  }
};
