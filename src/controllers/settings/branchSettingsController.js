const db = require('../../models');
const Branch = db.Branch;

// ==============================
// @desc    GET /api/settings/branch-settings
// @access  Private
// ==============================
exports.getBranchSettings = async (req, res) => {
  try {
    const branches = await Branch.findAll({ order: [['createdAt', 'DESC']] });
    res.status(200).json(branches);
  } catch (error) {
    console.error('❌ Error fetching branches:', error);
    res.status(500).json({ message: 'Failed to fetch branches' });
  }
};

// ==============================
// @desc    PUT /api/settings/branch-settings/:id
// @access  Private
// ==============================
exports.updateBranchSettings = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, code, location, manager } = req.body;

    const branch = await Branch.findByPk(id);
    if (!branch) {
      return res.status(404).json({ message: 'Branch not found' });
    }

    branch.name = name ?? branch.name;
    branch.code = code ?? branch.code;
    branch.location = location ?? branch.location;
    branch.manager = manager ?? branch.manager;

    await branch.save();

    res.status(200).json({ message: 'Branch updated successfully', branch });
  } catch (error) {
    console.error('❌ Error updating branch:', error);
    res.status(500).json({ message: 'Failed to update branch' });
  }
};
