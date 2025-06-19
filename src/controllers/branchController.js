// backend/src/controllers/branchController.js

const { Branch } = require('../models');

exports.getAllBranches = async (req, res) => {
  try {
    const branches = await Branch.findAll();
    res.status(200).json(branches);
  } catch (err) {
    console.error('Error fetching branches:', err);
    res.status(500).json({ error: 'Failed to fetch branches' });
  }
};

exports.createBranch = async (req, res) => {
  try {
    const newBranch = await Branch.create(req.body);
    res.status(201).json(newBranch);
  } catch (err) {
    console.error('Error creating branch:', err);
    res.status(400).json({ error: 'Failed to create branch' });
  }
};

exports.updateBranch = async (req, res) => {
  try {
    const branch = await Branch.findByPk(req.params.id);
    if (!branch) return res.status(404).json({ error: 'Branch not found' });

    await branch.update(req.body);
    res.json(branch);
  } catch (err) {
    console.error('Error updating branch:', err);
    res.status(500).json({ error: 'Failed to update branch' });
  }
};

exports.deleteBranch = async (req, res) => {
  try {
    const branch = await Branch.findByPk(req.params.id);
    if (!branch) return res.status(404).json({ error: 'Branch not found' });

    await branch.destroy();
    res.json({ message: 'Branch deleted successfully' });
  } catch (err) {
    console.error('Error deleting branch:', err);
    res.status(500).json({ error: 'Failed to delete branch' });
  }
};
