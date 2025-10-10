"use strict";

const express = require("express");
const router = express.Router();
const { authenticateUser } = require("../middleware/authMiddleware");
const roleController = require("../controllers/roleController");

// All protected
router.use(authenticateUser);

// List/create
router.get("/", roleController.getAllRoles);
router.post("/", roleController.createRole);

// Read/update/delete
router.get("/:id", roleController.getRoleById);
router.put("/:id", roleController.updateRole);
router.delete("/:id", roleController.deleteRole);

// Assignment helpers
router.get("/:id/assignments", roleController.listAssignments);
router.delete("/:id/assignments", roleController.clearAssignments);

module.exports = router;
