const express = require("express");
const router = express.Router();
const { allow } = require("../middleware/permissions");
const permissionsController = require("../controllers/permissionsController");

router.get("/", allow("manageSettings"), permissionsController.getPermissions);
router.put("/:action", allow("manageSettings"), permissionsController.updatePermission);

module.exports = router;
