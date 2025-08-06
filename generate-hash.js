const bcrypt = require('bcryptjs');

const password = 'Johsta67!';

bcrypt.hash(password, 10).then((hash) => {
  console.log(`Hashed password: ${hash}`);
});
