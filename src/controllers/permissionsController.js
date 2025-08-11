// src/controllers/permissionsController.js
const { Permission } = require("../models");

// GET all permissions
const getPermissions = async (req, res) => {
  try {
    const permissions = await Permission.findAll();
    res.json(permissions);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// UPDATE roles for an action
const updatePermission = async (req, res) => {
  try {
    const { action } = req.params;
    const { roles } = req.body;

    if (!Array.isArray(roles)) {
      return res.status(400).json({ error: "Roles must be an array" });
    }

    const permission = await Permission.findOne({ where: { action } });

    if (!permission) {
      return res.status(404).json({ error: `Action "${action}" not found` });
    }

    permission.roles = roles;
    await permission.save();

    res.json({ message: `Permissions for "${action}" updated`, updatedRoles: roles });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

module.exports = {
  getPermissions,
  updatePermission
};
