"use strict";

const db = require("../models"); // { Permission, Role, sequelize }
const { Op } = require("sequelize");
const CATALOG = require("../permissions/catalog");

/* ------------------------------- Helpers ---------------------------------- */

const normalizePermRow = (r) => ({
  id: r.id,
  action: r.action,
  roles: Array.isArray(r.roles) ? r.roles : [],
  description: r.description || "",
  isSystem: !!r.isSystem,
});

const roleMapFromList = (roles) => {
  // map lower(name) -> canonical display name
  const map = new Map();
  for (const r of roles) map.set(String(r.name).toLowerCase(), r.name);
  return map;
};

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
exports.getMatrix = async (_req, res) => {
  try {
    await ensureCatalogRows();

    const [roles, perms] = await Promise.all([
      db.Role.findAll({ order: [["name", "ASC"]] }),
      db.Permission.findAll({ order: [["action", "ASC"]] }),
    ]);

    const roleNameMap = roleMapFromList(roles); // lower -> Canonical
    const byAction = new Map(perms.map(p => [p.action, normalizePermRow(p)]));

    // Build matrix: { [actionKey]: string[]CanonicalRoleNames }
    const matrix = {};
    for (const group of CATALOG) {
      for (const act of group.actions) {
        const row = byAction.get(act.key);
        const names = [];
        if (row?.roles) {
          for (const r of row.roles) {
            const canon = roleNameMap.get(String(r).toLowerCase());
            if (canon) names.push(canon);
          }
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

// PUT /api/permissions/role/:roleId  { actions: string[], mode?: "replace"|"merge" }
exports.saveForRole = async (req, res) => {
  try {
    const { roleId } = req.params;
    const role = await db.Role.findByPk(roleId);
    if (!role) return res.status(404).json({ error: "Role not found" });

    const actions = Array.isArray(req.body?.actions) ? req.body.actions.map(String) : [];
    const mode = String(req.body?.mode || "replace").toLowerCase();

    await ensureCatalogRows();

    // Fetch all existing permissions relevant to provided actions
    const existing = await db.Permission.findAll({ where: { action: { [Op.in]: actions } } });
    const byAction = new Map(existing.map(p => [p.action, p]));

    for (const action of actions) {
      const row = byAction.get(action);
      if (!row) {
        await db.Permission.create({
          action,
          roles: [role.name],
          description: action,
        });
        continue;
      }

      const set = new Set((row.roles || []).map(x => String(x)));
      if (mode === "replace") {
        row.roles = [role.name];
      } else {
        set.add(role.name);
        row.roles = Array.from(set);
      }
      await row.save();
    }

    // If replace: remove this role from actions NOT included (Postgres JSONB-friendly branch)
    if (mode === "replace") {
      try {
        await db.Permission.update(
          { roles: db.sequelize.literal(`CASE
            WHEN roles @> '["${role.name}"]' THEN (
              SELECT jsonb_agg(x) FROM jsonb_array_elements_text(roles) x WHERE x <> '${role.name}'
            )
            ELSE roles END
          `) },
          { where: { action: { [Op.notIn]: actions } } }
        );
      } catch (_) {
        // For MySQL/SQLite: fallback to fetch-all and save
        const all = await db.Permission.findAll({ where: { action: { [Op.notIn]: actions } } });
        for (const p of all) {
          const set = new Set((p.roles || []).map(String));
          set.delete(role.name);
          p.roles = Array.from(set);
          await p.save();
        }
      }
    }

    res.json({ ok: true });
  } catch (e) {
    console.error("saveForRole error:", e);
    res.status(500).json({ error: "Failed to save role permissions" });
  }
};

// NEW: PUT /api/permissions/matrix  { matrix: { [actionKey]: string[]roleNames } }
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

    const actions = [];
    for (const g of CATALOG) for (const a of g.actions) actions.push(a.key);

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
      const label = CATALOG.find(g => g.actions.find(a => a.key === action))?.actions.find(a => a.key === action)?.label;
      if (!row.description && label) row.description = label;
      await row.save();
    }

    res.json({ ok: true });
  } catch (e) {
    console.error("saveEntireMatrix error:", e);
    res.status(500).json({ error: "Failed to save matrix" });
  }
};
