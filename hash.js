// hash.js
const bcrypt = require('bcryptjs');

async function run() {
  const plain = "admin123";
  const hashed = await bcrypt.hash(plain, 10);
  console.log("Hashed Password:", hashed);
}

run();
