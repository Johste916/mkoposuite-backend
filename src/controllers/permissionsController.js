// backend/src/controllers/permissionsController.js
const { Permission } = require('../models');

// GET all permissions
const getPermissions = async (_req, res) => {
  try {
    const rows = await Permission.findAll({ order: [['action', 'ASC']] });
    res.json(rows);
  } catch (err) {
    console.error('getPermissions error:', err);
    res.status(500).json({ error: 'Failed to fetch permissions' });
  }
};

// UPSERT a permission’s allowed roles (by action)
const updatePermission = async (req, res) => {
  try {
    const { action } = req.params;
    const { roles, description } = req.body;

    if (!action || typeof action !== 'string') {
      return res.status(400).json({ error: 'Invalid action' });
    }
    if (!Array.isArray(roles)) {
      return res.status(400).json({ error: 'Roles must be an array of role names' });
    }

    const payload = {
      action: action.trim(),
      roles: roles.map(String),
      description: typeof description === 'string' ? description : '',
    };

    const [row] = await Permission.upsert(payload);
    res.json({ message: `Permissions for "${action}" saved.`, permission: row || payload });
  } catch (err) {
    console.error('updatePermission error:', err);
    res.status(500).json({ error: 'Failed to update permission' });
  }
};

module.exports = { getPermissions, updatePermission };
