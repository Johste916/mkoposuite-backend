// backend/src/routes/permissions.js
const express = require("express");
const router = express.Router();

const permissionMatrixController = require("../controllers/permissionMatrixController");
const permissionsController = require("../controllers/permissionsController");

// Matrix endpoints (used by UI)
router.get("/permissions/matrix", permissionMatrixController.getMatrix);
router.put("/permissions/matrix", permissionMatrixController.saveEntireMatrix);
router.put("/permissions/role/:roleId", permissionMatrixController.saveForRole);

// Legacy/utility endpoints (optional)
router.get("/permissions", permissionsController.getPermissions);
router.post("/permissions", permissionsController.createPermission);
router.put("/permissions/:action", permissionsController.updatePermission);
router.delete("/permissions/:id", permissionsController.deletePermission);

module.exports = router;
