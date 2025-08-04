const { UserRole } = require('../models');

exports.assignRole = async (req, res) => {
  const { userId, roleId } = req.body;
  try {
    const record = await UserRole.create({ userId, roleId });
    res.status(201).json(record);
  } catch (err) {
    res.status(400).json({ error: 'Failed to assign role' });
  }
};
