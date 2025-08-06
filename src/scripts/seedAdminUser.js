// src/scripts/seedAdminUser.js
const bcrypt = require('bcryptjs');
const db = require('../models');

async function seedAdmin() {
  try {
    const hashedPassword = await bcrypt.hash('Johsta67!', 10);

    const [user, created] = await db.User.findOrCreate({
      where: { email: 'admin@example.com' },
      defaults: {
        name: 'System Admin',
        email: 'admin@example.com',
        password_hash: hashedPassword,
        role: 'admin',
      },
    });

    if (created) {
      console.log('✅ Admin user created.');
    } else {
      console.log('ℹ️ Admin user already exists.');
    }

    process.exit(0);
  } catch (error) {
    console.error('❌ Failed to create admin:', error);
    process.exit(1);
  }
}

seedAdmin();
