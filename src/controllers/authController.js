// src/controllers/authController.js

const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { User } = require('../models');

exports.login = async (req, res) => {
  const { email, password } = req.body;
  console.log(`🔐 Login attempt for: ${email}`);

  try {
    // 1. Find the user by email
    const user = await User.findOne({ where: { email } });

    if (!user) {
      console.log('❌ User not found');
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    // 2. Compare the password with the hash
    const isMatch = await bcrypt.compare(password, user.passwordHash);

    if (!isMatch) {
      console.log('❌ Password does not match');
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    // 3. Create JWT token
    const token = jwt.sign(
      { userId: user.id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '2h' }
    );

    console.log('✅ Login successful');
    res.json({
      token,
      user: {
