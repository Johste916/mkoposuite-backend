const express = require('express');
const router = express.Router();
const { authenticateUser } = require('../middleware/authMiddleware');

let branchController;
try {
  branchController = require('../controllers/branchController');
} catch {}

/** Fallback: simple list using model if controller missing */
const { Branch } = require('../models');

router.get('/', authenticateUser, async (req, res) => {
  // Prefer controller if present
  if (branchController?.getBranches) return branchController.getBranches(req, res);
  try {
    const rows = await (Branch?.findAll?.({ attributes: ['id', 'name', 'code'], order: [['name', 'ASC']] }) || []);
    res.json(rows);
  } catch (e) {
    console.error('branches fallback error:', e);
    res.status(500).json({ error: 'Failed to load branches' });
  }
});

router.post('/', authenticateUser, async (req, res) => {
  if (branchController?.createBranch) return branchController.createBranch(req, res);
  if (!Branch?.create) return res.status(501).json({ error: 'Branch controller not available' });
  try {
    const created = await Branch.create({ name: req.body?.name, code: req.body?.code || null, location: req.body?.location || null });
    res.status(201).json(created);
  } catch (e) {
    res.status(400).json({ error: 'Failed to create branch' });
  }
});

module.exports = router;
