const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { sequelize } = require('../models'); // ⬅️ Make sure you import sequelize directly
require('dotenv').config();

const JWT_SECRET = process.env.JWT_SECRET;

exports.login = async (req, res) => {
  const { email, password } = req.body;

  try {
    // 🔥 Use raw SQL query instead of Sequelize findOne
    const [users] = await sequelize.query(
      `SELECT id, name, email, role, password_hash FROM "Users" WHERE email = :email LIMIT 1`,
      {
        replacements: { email },
        type: sequelize.QueryTypes.SELECT
      }
    );

    const user = users;

    if (!user) {
      console.log("❌ No user found with email:", email);
      return res.status(401).json({ message: 'Invalid email or password ❌' });
    }

    console.log("✅ User found:", user.email);
    console.log("🔐 Hashed password from DB:", user.password_hash);
    console.log("🔑 Password entered by user:", password);

    const isMatch = await bcrypt.compare(password, user.password_hash);

    if (!isMatch) {
      console.log("❌ Password mismatch");
      return res.status(401).json({ message: 'Invalid email or password ❌' });
    }

    console.log("✅ Password matched. Logging in...");

    const token = jwt.sign(
      { userId: user.id, email: user.email },
      JWT_SECRET,
      { expiresIn: '2h' }
    );

    res.status(200).json({
      message: 'Login successful ✅',
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role
      }
    });

  } catch (error) {
    console.error('❌ Login error (raw SQL):', error);
    res.status(500).json({ message: 'Server error' });
  }
};
