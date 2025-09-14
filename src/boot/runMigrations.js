'use strict';

const { Umzug, SequelizeStorage } = require('umzug');
const path = require('path');

/**
 * Runs all pending Sequelize migrations using Umzug before the server starts.
 * Safe to call multiple times; Umzug records applied migrations in the DB.
 */
module.exports = async function runMigrations(sequelize) {
  if (!sequelize) throw new Error('runMigrations: sequelize instance is required');

  const umzug = new Umzug({
    migrations: { glob: path.join(__dirname, '../migrations/*.js') },
    context: sequelize.getQueryInterface(),
    storage: new SequelizeStorage({ sequelize }), // uses table `SequelizeMeta`
    logger: console,
  });

  // Expose programmatic helpers if you ever need them elsewhere
  module.exports._umzug = umzug;

  console.log('🔧 Running DB migrations (Umzug)…');
  const pending = await umzug.pending();
  if (pending.length) {
    console.log(`   • ${pending.length} pending migration(s):`, pending.map(m => m.name));
  } else {
    console.log('   • No pending migrations.');
  }

  await umzug.up();
  console.log('✅ Migrations complete.');
};
