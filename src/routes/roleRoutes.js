// backend/src/routes/roleRoutes.js
"use strict";

const express = require("express");
const router = express.Router();

let authenticateUser;
try {
  ({ authenticateUser } = require("../middleware/authMiddleware"));
} catch {}
const guard = (fn) => (typeof fn === "function" ? fn : (_req, _res, next) => next());

const roleController = require("../controllers/roleController");

// List & create
router.get("/", guard(authenticateUser), roleController.getAllRoles);
router.post("/", guard(authenticateUser), roleController.createRole);

// Read / Update / Delete (these fix the 404s your UI was hitting)
router.get("/:id", guard(authenticateUser), roleController.getRoleById);
router.put("/:id", guard(authenticateUser), roleController.updateRole);
router.delete("/:id", guard(authenticateUser), roleController.deleteRole);

module.exports = router;
