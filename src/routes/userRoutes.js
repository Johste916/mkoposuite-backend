// routes/userRoutes.js
const express = require('express');
const router = express.Router();
const { User } = require('../../models');

// Get all users
router.get('/', async (req, res) => {
  try {
    const users = await User.findAll({ attributes: ['id', 'name', 'email', 'role'] });
    res.status(200).json(users);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
