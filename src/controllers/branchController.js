const { Branch } = require('../models');

// GET /api/branches
exports.getBranches = async (_req, res) => {
  try {
    const branches = await Branch.findAll({ order: [['name', 'ASC']] });
    res.json(branches);
  } catch (err) {
    console.error('getBranches error:', err);
    res.status(500).json({ error: 'Failed to fetch branches' });
  }
};

// POST /api/branches
exports.createBranch = async (req, res) => {
  try {
    const branch = await Branch.create(req.body);
    res.status(201).json(branch);
  } catch (err) {
    console.error('createBranch error:', err);
    res.status(400).json({ error: 'Failed to create branch' });
  }
};
