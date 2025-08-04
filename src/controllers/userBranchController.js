const { UserBranch } = require('../models');

exports.assignBranch = async (req, res) => {
  const { userId, branchId } = req.body;
  try {
    const record = await UserBranch.create({ userId, branchId });
    res.status(201).json(record);
  } catch (err) {
    res.status(400).json({ error: 'Failed to assign branch' });
  }
};
