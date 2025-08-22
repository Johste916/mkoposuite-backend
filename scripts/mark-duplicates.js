// scripts/mark-duplicates.js
const { Sequelize } = require('sequelize');
const path = require('path');
const env = process.env.NODE_ENV || 'development';
const cfg = require(path.resolve(__dirname, '../config/config.js'))[env];

const sequelize = cfg.url
  ? new Sequelize(cfg.url, cfg)
  : new Sequelize(cfg.database, cfg.username, cfg.password, cfg);

const NAMES = [
  '20250803165948-create-loan-settings.js',
  '20250803165950-create-system-settings.js',
  '20250811062750-create_loan_schedule.js',
  '20250811063015-create_audit_logs.js',
  '20250811064113-disbursement_tables.js',
  '20250811073452-create_permissions_table.js',
  '20250812083151-create-accounts.js',
  '20250812083406-create-journal-entries.js',
  '20250812083438-create-ledger-entries.js',
  '20250813082201-alter-settings.js',
];

(async () => {
  try {
    for (const name of NAMES) {
      await sequelize.query(
        `INSERT INTO "SequelizeMeta" ("name")
         SELECT :name
         WHERE NOT EXISTS (SELECT 1 FROM "SequelizeMeta" WHERE "name" = :name);`,
        { replacements: { name } }
      );
    }
    console.log('✅ Marked duplicates as done in SequelizeMeta');
  } catch (e) {
    console.error('❌ Failed to mark duplicates:', e);
    process.exit(1);
  } finally {
    await sequelize.close();
  }
})();
