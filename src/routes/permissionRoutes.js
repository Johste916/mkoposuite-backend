// backend/src/routes/permissionRoutes.js
"use strict";

const express = require("express");
const router = express.Router();

const matrixCtl = require("../controllers/permissionMatrixController");
let permsCtl = null;
try { permsCtl = require("../controllers/permissionsController"); } catch {}

/**
 * All routes here are relative to /api/permissions
 * e.g. GET /matrix => /api/permissions/matrix
 */

// Matrix used by the UI
router.get("/matrix", matrixCtl.getMatrix);
router.put("/role/:roleId", matrixCtl.saveForRole);

// Optional: bulk save if you implemented saveEntireMatrix
if (typeof matrixCtl.saveEntireMatrix === "function") {
  router.put("/matrix", matrixCtl.saveEntireMatrix);
} else {
  router.put("/matrix", (_req, res) =>
    res.status(501).json({ error: "Bulk save not implemented. Use PUT /api/permissions/role/:roleId" })
  );
}

// Utilities / legacy (optional)
if (permsCtl) {
  router.get("/", permsCtl.getPermissions);
  router.post("/", permsCtl.createPermission);
  router.put("/:action", permsCtl.updatePermission);
  router.delete("/:id", permsCtl.deletePermission);
  if (permsCtl.getRolePermissions) router.get("/role/:roleId", permsCtl.getRolePermissions);
}

// Tiny ping to confirm mount quickly
router.get("/ping", (_req, res) => res.json({ ok: true }));

module.exports = router;
