// server/src/bootstrap/autoSync.js
const { sequelize } = require('../models');

module.exports = async function autoSync() {
  if (process.env.NODE_ENV === 'production' && process.env.AUTO_SYNC !== '1') {
    console.log('⏭️  Skipping Sequelize auto-sync (production & AUTO_SYNC != 1)');
    return;
  }
  console.log('🔄 Sequelize auto-sync starting…');
  await sequelize.authenticate();
  if (process.env.DB_SCHEMA) {
    await sequelize.createSchema(process.env.DB_SCHEMA).catch(() => {});
  }
  await sequelize.sync({ alter: true, logging: console.log });
  console.log('✅ Sequelize auto-sync complete');
};
