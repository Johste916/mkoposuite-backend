const bcrypt = require('bcryptjs');

const storedHash = '$2a$10$2r89efmzbe4Py5NZBdECLeAMfu.1CV4JqMhUxGP83BcyDolNuMgHW';

const testPasswords = ['admin123', '123456', 'password', 'test@123', 'Johsta67!', 'admin'];

testPasswords.forEach(async (password) => {
  const match = await bcrypt.compare(password, storedHash);
  if (match) {
    console.log(`✅ MATCHED PASSWORD: ${password}`);
  }
});
