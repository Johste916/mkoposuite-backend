// src/controllers/authController.js

const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { User } = require('../models');

exports.login = async (req, res) => {
  const { email, password } = req.body;
  console.log(`🔐 Login attempt for: ${email}`);

  try {
    // 1. Find user by email
    const user = await User.findOne({ where: { email } });

    if (!user) {
      console.log('❌ User not found');
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    // 2. Compare password with stored hash
    const isMatch = await bcrypt.compare(password, user.passwordHash);
    if (!isMatch) {
      console.log('❌ Invalid password');
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    // 3. Create JWT token
    const token = jwt.sign(
      { userId: user.id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '2h' }
    );

    // 4. Respond with token and user data
    console.log('✅ Login successful');
    return res.json({
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        branchId: user.branchId,
      }
    });

  } catch (err) {
    console.error('🔥 Error during login:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};
