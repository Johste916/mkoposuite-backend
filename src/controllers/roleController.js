// backend/src/controllers/roleController.js
const { Role } = require('../models');

exports.getAllRoles = async (_req, res) => {
  try {
    const roles = await Role.findAll({ order: [['name', 'ASC']] });
    res.json(roles);
  } catch (err) {
    console.error('getAllRoles error:', err);
    res.status(500).json({ error: 'Failed to fetch roles' });
  }
};

exports.createRole = async (req, res) => {
  try {
    const { name, description } = req.body || {};
    if (!name || String(name).trim().length < 2) {
      return res.status(400).json({ error: 'Role name is required' });
    }
    const role = await Role.create({
      name: String(name).trim(),
      description: String(description || ''),
      isSystem: false,
    });
    res.status(201).json(role);
  } catch (err) {
    console.error('createRole error:', err);
    res.status(400).json({ error: 'Failed to create role' });
  }
};
