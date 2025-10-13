// backend/src/routes/permissionRoutes.js   <-- NOTE: singular file name
"use strict";

const express = require("express");
const router = express.Router();

const matrixCtl = require("../controllers/permissionMatrixController");
let permsCtl = null;
try { permsCtl = require("../controllers/permissionsController"); } catch {}

/**
 * ROUTES ARE RELATIVE TO /api/permissions
 * So /matrix here => /api/permissions/matrix
 */

// ----- Matrix endpoints used by the UI -----
router.get("/matrix", matrixCtl.getMatrix);

// Per-role save (present in your controller)
router.put("/role/:roleId", matrixCtl.saveForRole);

// Optional: bulk save entire matrix (guarded in case not implemented)
if (typeof matrixCtl.saveEntireMatrix === "function") {
  router.put("/matrix", matrixCtl.saveEntireMatrix);
} else {
  // If your UI never calls this, you can delete this fallback.
  router.put("/matrix", (_req, res) =>
    res.status(501).json({ error: "Bulk save not implemented. Use PUT /api/permissions/role/:roleId" })
  );
}

// ----- Legacy/utility endpoints (namespaced so they don't conflict) -----
if (permsCtl) {
  // List all raw permission rows
  router.get("/", permsCtl.getPermissions);
  // Create a single permission row
  router.post("/", permsCtl.createPermission);
  // Update one row by action name
  router.put("/:action", permsCtl.updatePermission);
  // Delete by id
  router.delete("/:id", permsCtl.deletePermission);

  // (Optional helper) Get actions for a role
  if (permsCtl.getRolePermissions) {
    router.get("/role/:roleId", permsCtl.getRolePermissions);
  }
}

module.exports = router;
