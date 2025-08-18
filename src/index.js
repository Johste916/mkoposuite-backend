// backend/src/index.js
const app = require('./app');
const db = require('./models');
const { sequelize } = db;

const cron = require('node-cron');
let penaltiesTask;
try {
  const { runPenaltiesJob } = require('./jobs/penaltiesJob');
  penaltiesTask = cron.schedule('0 2 * * *', async () => {
    console.log('[cron] penalties job started');
    try {
      await runPenaltiesJob();
      console.log('[cron] penalties job finished');
    } catch (e) {
      console.error('[cron] penalties job failed:', e);
    }
  });
} catch (e) {
  console.warn('⚠️ penaltiesJob not wired (optional):', e.message);
}

const PORT = process.env.PORT || 10000;
let server;

/* ------------------------------ One-off helpers ------------------------------ */
async function ensureSettingsOnly() {
  console.log("🔧 Syncing ONLY 'settings' table…");
  await db.Setting.sync();
  console.log('✅ Setting model sync completed');
}

async function ensureAclTablesAndSeed() {
  console.log('🔧 Syncing ACL tables and seeding defaults (Roles, Permissions, UserRoles)…');
  await db.Role.sync({ alter: true });
  await db.Permission.sync({ alter: true });
  await db.UserRole.sync({ alter: true });

  try {
    const { ensureRolesAndPerms } = require('./seed/ensureRolesAndPerms');
    await ensureRolesAndPerms(db);
    console.log('✅ ACL ready');
  } catch (e) {
    console.warn('⚠️ ensureRolesAndPerms not available:', e.message);
  }
}

async function ensureAuditTables() {
  if (!db.AuditLog) {
    console.log('ℹ️ AuditLog model not loaded; skipping audit sync.');
    return;
  }
  console.log('🔧 Syncing AuditLog table…');
  await db.AuditLog.sync({ alter: true });
  console.log('✅ AuditLog ready');
}

/* --------------------------------- Startup --------------------------------- */
(async () => {
  try {
    await sequelize.authenticate();
    console.log('✅ Connected to the database');

    const syncSettingsOnly = process.env.SYNC_SETTINGS_ONLY === 'true';
    const syncACL          = process.env.SYNC_ACL === 'true';
    const syncAudit        = process.env.SYNC_AUDIT === 'true';

    if (syncSettingsOnly) await ensureSettingsOnly();
    else console.log('⏭  Skipping settings sync (set SYNC_SETTINGS_ONLY=true for one-off)');

    if (syncACL) await ensureAclTablesAndSeed();
    else console.log('⏭  Skipping ACL sync (set SYNC_ACL=true for first boot)');

    if (syncAudit) await ensureAuditTables();
    else console.log('⏭  Skipping Audit sync (set SYNC_AUDIT=true to create/alter audit_logs)');

    server = app.listen(PORT, () => {
      console.log(`🚀 Server is running on port ${PORT}`);
    });
  } catch (err) {
    console.error('❌ Unable to connect to the database:', err);
    process.exit(1);
  }
})();

/* -------------------------------- Shutdown -------------------------------- */
async function shutdown(signal) {
  try {
    console.log(`\n🧹 Received ${signal}. Shutting down gracefully...`);
    if (penaltiesTask?.stop) penaltiesTask.stop();

    if (server) {
      await new Promise((resolve) => server.close(resolve));
      console.log('🛑 HTTP server closed');
    }
    await sequelize.close();
    console.log('🔌 DB connection closed');
    process.exit(0);
  } catch (e) {
    console.error('💥 Error during shutdown:', e);
    process.exit(1);
  }
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));
process.on('unhandledRejection', (reason) => {
  console.error('⚠️ Unhandled Rejection:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('⚠️ Uncaught Exception:', err);
});
