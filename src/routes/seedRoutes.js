const express = require('express');
const bcrypt = require('bcryptjs');
const router = express.Router();
const { User } = require('../models');

router.post('/seed-admin', async (req, res) => {
  try {
    const email = 'admin@example.com';
    const existingUser = await User.findOne({ where: { email } });

    if (existingUser) {
      return res.status(400).json({ message: 'Admin user already exists' });
    }

    const hashedPassword = await bcrypt.hash('Johsta67!', 10);

    const user = await User.create({
      name: 'Admin',
      email,
      password_hash: hashedPassword,
      role: 'admin',
    });

    res.status(201).json({ message: 'Admin user created ✅', user });
  } catch (err) {
    console.error('❌ Error creating admin user:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
