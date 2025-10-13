"use strict";

const db = require("../models"); // { Permission, Role, sequelize }
const { Op } = require("sequelize");
const CATALOG = require("../permissions/catalog");

/* ------------------------------- Helpers ---------------------------------- */

const roleMapFromList = (roles) => {
  // map lower(name) -> canonical display name
  const map = new Map();
  for (const r of roles) map.set(String(r.name).toLowerCase(), r.name);
  return map;
};

function allCatalogActionKeys() {
  const keys = [];
  for (const g of CATALOG) for (const a of g.actions) keys.push(a.key);
  return keys;
}

async function ensureCatalogRows() {
  // Upsert all actions so the table always contains the catalog.
  const actions = [];
  for (const g of CATALOG) for (const a of g.actions) actions.push({ key: a.key, label: a.label });

  const existing = await db.Permission.findAll({
    where: { action: { [Op.in]: actions.map(a => a.key) } },
  });
  const existingSet = new Set(existing.map((p) => p.action));

  const toCreate = actions.filter(a => !existingSet.has(a.key));
  if (toCreate.length) {
    await db.Permission.bulkCreate(
      toCreate.map(a => ({
        action: a.key,
        description: a.label,
        roles: [],
        isSystem: true,
      })),
      { ignoreDuplicates: true }
    );
  }

  // soft-sync labels for existing (don't override custom descriptions unless empty)
  for (const a of actions) {
    await db.Permission.update(
      { description: a.label },
      { where: { action: a.key, [Op.or]: [{ description: null }, { description: "" }] } }
    ).catch(() => {});
  }
}

/* -------------------------------- Routes ---------------------------------- */

// GET /api/permissions/matrix
// Shape the UI expects: { catalog, roles, matrix: { [actionKey]: string[] } }
exports.getMatrix = async (_req, res) => {
  try {
    await ensureCatalogRows();

    const [roles, perms] = await Promise.all([
      db.Role.findAll({ order: [["name", "ASC"]] }),
      db.Permission.findAll({ order: [["action", "ASC"]] }),
    ]);

    const roleNameMap = roleMapFromList(roles); // lower -> Canonical
    const byAction = new Map(perms.map(p => [p.action, p]));

    // Build matrix: { [actionKey]: string[]CanonicalRoleNames }
    const matrix = {};
    for (const group of CATALOG) {
      for (const act of group.actions) {
        const row = byAction.get(act.key);
        const names = [];
        const rawRoles = Array.isArray(row?.roles) ? row.roles : [];
        for (const r of rawRoles) {
          const canon = roleNameMap.get(String(r).toLowerCase());
          if (canon) names.push(canon);
        }
        matrix[act.key] = names;
      }
    }

    res.json({
      catalog: CATALOG,
      roles: roles.map(r => ({ id: r.id, name: r.name, isSystem: !!r.isSystem })),
      matrix,
    });
  } catch (e) {
    console.error("getMatrix error:", e);
    res.status(500).json({ error: "Failed to build permission matrix" });
  }
};

// PUT /api/permissions/role/:roleId
// Body: { actions: string[] }  — sets membership for THIS role only.
// If an action is listed => ensure role is present. If not listed => ensure role is removed.
exports.saveForRole = async (req, res) => {
  try {
    const { roleId } = req.params;
    const role = await db.Role.findByPk(roleId);
    if (!role) return res.status(404).json({ error: "Role not found" });

    const wanted = new Set(
      Array.isArray(req.body?.actions) ? req.body.actions.map(String) : []
    );

    await ensureCatalogRows();

    // Work against the *full* catalog of actions so we can add/remove consistently
    const allActions = allCatalogActionKeys();

    // Fetch all permission rows in one go
    const rows = await db.Permission.findAll({
      where: { action: { [Op.in]: allActions } },
    });
    const byAction = new Map(rows.map(p => [p.action, p]));

    // Adjust each action for THIS role only (do not affect other roles)
    for (const action of allActions) {
      const row = byAction.get(action) || db.Permission.build({ action, roles: [] });

      const set = new Set((row.roles || []).map(x => String(x)));
      if (wanted.has(action)) set.add(role.name); else set.delete(role.name);

      row.roles = Array.from(set);

      // ensure description exists (from catalog)
      if (!row.description) {
        const label = CATALOG.find(g => g.actions.some(a => a.key === action))
          ?.actions.find(a => a.key === action)?.label;
        if (label) row.description = label;
      }
      await row.save();
    }

    res.json({ ok: true });
  } catch (e) {
    console.error("saveForRole error:", e);
    res.status(500).json({ error: "Failed to save role permissions" });
  }
};

// OPTIONAL bulk: PUT /api/permissions/matrix  { matrix: { [actionKey]: string[]roleNames } }
exports.saveEntireMatrix = async (req, res) => {
  try {
    const incoming = req.body?.matrix || {};
    if (!incoming || typeof incoming !== "object") {
      return res.status(400).json({ error: "matrix is required" });
    }

    await ensureCatalogRows();

    const roles = await db.Role.findAll();
    const roleNameMap = roleMapFromList(roles);  // lower -> Canonical
    const canonicalSet = new Set(roles.map(r => r.name));

    const actions = allCatalogActionKeys();

    const existing = await db.Permission.findAll({ where: { action: { [Op.in]: actions } } });
    const byAction = new Map(existing.map(p => [p.action, p]));

    for (const action of actions) {
      const row = byAction.get(action) || db.Permission.build({ action, roles: [] });
      const raw = Array.isArray(incoming[action]) ? incoming[action] : [];
      // normalize: keep only known roles, dedupe, map to canonical casing
      const clean = Array.from(
        new Set(
          raw
            .map(x => roleNameMap.get(String(x).toLowerCase()))
            .filter(Boolean)
        )
      ).filter(r => canonicalSet.has(r));

      row.roles = clean;

      // ensure description exists (from catalog)
      if (!row.description) {
        const label = CATALOG.find(g => g.actions.some(a => a.key === action))
          ?.actions.find(a => a.key === action)?.label;
        if (label) row.description = label;
      }

      await row.save();
    }

    res.json({ ok: true });
  } catch (e) {
    console.error("saveEntireMatrix error:", e);
    res.status(500).json({ error: "Failed to save matrix" });
  }
};
