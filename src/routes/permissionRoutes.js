// backend/src/routes/permissionsRoutes.js
"use strict";

const express = require("express");
const path = require("path");
const { pathToFileURL } = require("url");

const router = express.Router();

/* ---------------- Models (soft) ---------------- */
let db = {};
try { db = require("../models"); } catch {} // tolerate boot order
const hasPermissionModel = !!db?.Permission;

/* ---------------- Auth (soft) ---------------- */
let authenticateUser = (_req, _res, next) => next();
try { ({ authenticateUser } = require("../middleware/authMiddleware")); } catch {}
router.use(authenticateUser);

/* ---------------- util: load CJS or ESM safely ----------------
   - First try require()
   - If ERR_REQUIRE_ESM, fallback to dynamic import()
   - Cache loaded modules so we don't re-import on every request
----------------------------------------------------------------- */
const _cache = new Map();

async function tryLoad(moduleRelPath) {
  if (_cache.has(moduleRelPath)) return _cache.get(moduleRelPath);

  const abs = path.join(__dirname, "..", "controllers", moduleRelPath);
  try {
    // Try CommonJS first
    // eslint-disable-next-line global-require, import/no-dynamic-require
    const mod = require(abs);
    _cache.set(moduleRelPath, mod?.default || mod || {});
    return _cache.get(moduleRelPath);
  } catch (e) {
    if (e && e.code === "ERR_REQUIRE_ESM") {
      // Fallback to ESM dynamic import
      const url = pathToFileURL(abs + (abs.endsWith(".js") ? "" : ".js")).href;
      const esm = await import(url);
      _cache.set(moduleRelPath, esm?.default || esm || {});
      return _cache.get(moduleRelPath);
    }
    // Other errors (file missing etc.) -> empty object
    _cache.set(moduleRelPath, {});
    return _cache.get(moduleRelPath);
  }
}

/* ---------------- Controllers (lazy) ----------------
   We resolve them lazily so startup never fails, and
   we can tolerate both CJS and ESM exports.
------------------------------------------------------ */
const loadBasicCtl  = () => tryLoad("permissionsController");        // updatePermission, etc.
const loadMatrixCtl = () => tryLoad("permissionMatrixController");    // getMatrix, saveForRole

/* ===================== MATRIX ===================== */
/** GET /api/permissions/matrix -> { roles, matrix } */
router.get("/matrix", async (req, res) => {
  const ctl = await loadMatrixCtl();
  if (typeof ctl.getMatrix === "function") return ctl.getMatrix(req, res);
  return res.status(501).json({ error: "permissionMatrixController.getMatrix not available" });
});

/** PUT /api/permissions/role/:roleId body: { actions: string[], mode?: "replace"|"merge" } */
router.put("/role/:roleId", async (req, res) => {
  const ctl = await loadMatrixCtl();
  if (typeof ctl.saveForRole === "function") return ctl.saveForRole(req, res);
  return res.status(501).json({ error: "permissionMatrixController.saveForRole not available" });
});

/* ========== BASIC list/create/delete (CJS/ESM safe) ========== */

/** GET /api/permissions  -> [{ id, name, description }] */
router.get("/", async (_req, res, next) => {
  try {
    if (!hasPermissionModel) {
      return res.status(501).json({ error: "Permission model not available" });
    }
    const items = await db.Permission.findAll({ order: [["action", "ASC"]] });
    return res.json(items.map(p => ({
      id: p.id,
      name: p.action,
      description: p.description,
    })));
  } catch (e) { next(e); }
});

/** POST /api/permissions  body: { name } */
router.post("/", async (req, res, next) => {
  try {
    if (!hasPermissionModel) {
      return res.status(501).json({ error: "Permission model not available" });
    }
    const name = (req.body?.name || "").trim();
    if (!name) return res.status(400).json({ error: "name required" });

    const p = await db.Permission.create({ action: name, roles: [], description: name });
    return res.json({ id: p.id, name: p.action, description: p.description });
  } catch (e) { next(e); }
});

/** DELETE /api/permissions/:id */
router.delete("/:id", async (req, res, next) => {
  try {
    if (!hasPermissionModel) {
      return res.status(501).json({ error: "Permission model not available" });
    }
    await db.Permission.destroy({ where: { id: req.params.id } });
    return res.json({ ok: true });
  } catch (e) { next(e); }
});

/* ========== Optional upsert-by-action ========== */
/** PUT /api/permissions/:action  body: { roles: string[], description? } */
router.put("/:action", async (req, res) => {
  const ctl = await loadBasicCtl();
  if (typeof ctl.updatePermission === "function") {
    return ctl.updatePermission(req, res);
  }
  return res.status(501).json({ error: "permissionsController.updatePermission not available" });
});

module.exports = router;
