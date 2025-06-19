// backend/scripts/resetPassword.js
const bcrypt = require('bcryptjs');
const { sequelize, User } = require('../src/models');

const resetPassword = async () => {
  try {
    await sequelize.authenticate();
    console.log('✅ Connected to DB');

    const newPlainPassword = 'Johsta67!';
    const newHashedPassword = await bcrypt.hash(newPlainPassword, 10);

    console.log('🔑 Hashed Password:', newHashedPassword);

    const [updated] = await User.update(
      { password: newHashedPassword },
      { where: { email: 'admin@johsta.com' } }
    );

    if (updated) {
      console.log('✅ Password updated for admin@johsta.com');
    } else {
      console.log('⚠️ No user found with email admin@johsta.com');
    }

    await sequelize.close();
  } catch (error) {
    console.error('❌ Error:', error);
  }
};

resetPassword();
