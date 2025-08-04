const { User, Role, Branch } = require('../models');

// GET all users
exports.getAllUsers = async (req, res) => {
  try {
    const users = await User.findAll({
      include: ['roles', 'branches']
    });
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch users' });
  }
};

// CREATE user
exports.createUser = async (req, res) => {
  try {
    const user = await User.create(req.body);
    res.status(201).json(user);
  } catch (err) {
    res.status(400).json({ error: 'Failed to create user' });
  }
};
