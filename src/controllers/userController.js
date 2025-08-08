const { User, Role, Branch } = require('../models');

// GET /api/users?role=loan_officer (role filter optional)
exports.getUsers = async (req, res) => {
  try {
    const { role } = req.query;

    // If your User table has a 'role' column, this will work directly.
    // If you use a Role table or many-to-many, we still include Role/Branch and filter in code.
    const where = role ? { role } : {};

    const include = [];
    if (Role) include.push({ model: Role, attributes: ['id', 'name'], through: { attributes: [] }, required: false });
    if (Branch) include.push({ model: Branch, attributes: ['id', 'name'], through: { attributes: [] }, required: false });

    const users = await User.findAll({
      where,
      include,
      order: [['createdAt', 'DESC']],
      limit: 200,
    });

    // If role was requested but you don't have a 'role' column, filter via joined Role name
    const data = role && Role
      ? users.filter(u => (u.role || u.Role?.name) === role || (Array.isArray(u.Roles) && u.Roles.some(r => r.name === role)))
      : users;

    res.json(data);
  } catch (err) {
    console.error('getUsers error:', err);
    res.status(500).json({ error: 'Failed to list users' });
  }
};

// POST /api/users
exports.createUser = async (req, res) => {
  try {
    const user = await User.create(req.body);
    res.status(201).json(user);
  } catch (err) {
    console.error('createUser error:', err);
    res.status(400).json({ error: 'Failed to create user' });
  }
};
