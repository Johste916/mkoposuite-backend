// src/middleware/permissions.js
const { Permission } = require("../models");

function allow(action) {
  return async (req, res, next) => {
    try {
      const role = req.user?.role;
      if (!role) return res.status(401).json({ error: "Unauthorized" });

      // Admin bypasses
      if (role === "Admin") return next();

      const permission = await Permission.findOne({ where: { action } });
      if (!permission) {
        return res.status(404).json({ error: `Action "${action}" not found in permissions` });
      }

      if (!permission.roles.includes(role)) {
        return res
          .status(403)
          .json({ error: `Forbidden: ${action} requires one of [${permission.roles.join(", ")}]` });
      }

      next();
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  };
}

module.exports = { allow };
