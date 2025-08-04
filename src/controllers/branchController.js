const { Branch } = require('../models');

exports.getAllBranches = async (req, res) => {
  try {
    const branches = await Branch.findAll();
    res.json(branches);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch branches' });
  }
};

exports.createBranch = async (req, res) => {
  try {
    const branch = await Branch.create(req.body);
    res.status(201).json(branch);
  } catch (err) {
    res.status(400).json({ error: 'Failed to create branch' });
  }
};
