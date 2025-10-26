'use strict';

// Load .env safely (won't crash if dotenv isn't installed on the server)
try { require('dotenv').config(); } catch {}

const app = require('./app');
const db = require('./models');
const { sequelize } = db;

/* ------------------------------ Optional deps ------------------------------ */
let cron;
try { cron = require('node-cron'); } catch { /* optional */ }

/* ---------------------------- Optional auto-sync --------------------------- */
let autoSync;
try {
  autoSync = require('./bootstrap/autoSync');
  if (autoSync && autoSync.default && typeof autoSync.default === 'function') {
    autoSync = autoSync.default;
  }
} catch { /* optional */ }

/* ----------------------------- Run migrations ------------------------------ */
let runMigrations = async () => {
  console.warn('⚠️  runMigrations not found; skipping DB migrations.');
};
try {
  const m = require('./boot/runMigrations');
  runMigrations = (m && m.default) ? m.default : m;
} catch { /* handled by no-op above */ }

/* --------------------------------- CRON ------------------------------------ */
let penaltiesTask;
try {
  if (cron) {
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
  } else {
    console.warn('ℹ️ node-cron not installed; skipping penalties cron job.');
  }
} catch (e) {
  console.warn('⚠️ penaltiesJob not wired (optional):', e.message);
}

/* ----------------------------- One-off helpers ----------------------------- */
/** Only the `settings` table (rare; for first boot of config) */
async function ensureSettingsOnly() {
  if (!db.Setting) {
    console.log('ℹ️ Setting model not present; skipping.');
    return;
  }
  console.log("🔧 Syncing ONLY 'settings' table…");
  await db.Setting.sync({ alter: true });
  console.log('✅ Setting model sync completed');
}

/** ACL tables + seed (roles/permissions/admin assignment) */
async function ensureAclTablesAndSeed() {
  if (!db.Role || !db.Permission || !db.UserRole) {
    console.log('ℹ️ ACL models missing; skipping ACL sync.');
    return;
  }
  console.log('🔧 Syncing ACL tables and seeding defaults…');
  await db.Role.sync({ alter: true });
  await db.Permission.sync({ alter: true });
  await db.UserRole.sync({ alter: true });

  try {
    const { ensureRolesAndPerms } = require('./seed/ensureRolesAndPerms');
    await ensureRolesAndPerms(db);
    console.log('✅ ensureRolesAndPerms: roles, permissions, and admin assignment ready');
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

async function ensureSavingsTables() {
  if (!db.SavingsTransaction) {
    console.log('ℹ️ SavingsTransaction model not loaded; skipping savings sync.');
    return;
  }
  console.log('🔧 Syncing SavingsTransaction table…');
  await db.SavingsTransaction.sync({ alter: true });
  console.log('✅ SavingsTransaction ready');
}

async function ensureExpensesTables() {
  if (!db.Expense) {
    console.log('ℹ️ Expense model not loaded; skipping expenses sync.');
    return;
  }
  console.log('🔧 Syncing Expense table…');
  await db.Expense.sync({ alter: true });
  console.log('✅ Expense ready');
}

/** Core portfolio/accounting tables commonly needed by reports */
async function ensureCoreTables() {
  console.log('🔧 Syncing CORE tables (create/alter as needed)…');

  if (db.Branch)        await db.Branch.sync({ alter: true });
  if (db.Borrower)      await db.Borrower.sync({ alter: true });
  if (db.LoanProduct)   await db.LoanProduct.sync({ alter: true });
  if (db.Loan)          await db.Loan.sync({ alter: true });
  if (db.LoanPayment)   await db.LoanPayment.sync({ alter: true });
  if (db.User)          await db.User.sync({ alter: true });
  if (db.Setting)       await db.Setting.sync({ alter: true });
  if (db.LoanSchedule)  await db.LoanSchedule.sync({ alter: true });
  if (db.LoanFee)       await db.LoanFee.sync({ alter: true });

  // Accounting
  if (db.Account)       await db.Account.sync({ alter: true });
  if (db.JournalEntry)  await db.JournalEntry.sync({ alter: true });
  if (db.LedgerEntry)   await db.LedgerEntry.sync({ alter: true });

  console.log('✅ CORE tables ready');
}

/* --------------------------------- Startup --------------------------------- */
const PORT = Number(process.env.PORT || 10000);
let server;

(async () => {
  try {
    await sequelize.authenticate();
    console.log('✅ Connected to the database');

    // Migrations first
    await runMigrations(sequelize);

    // Optional syncs (prefer migrations)
    if (process.env.AUTO_SYNC === '1' && typeof autoSync === 'function') {
      await autoSync();
    } else {
      const syncSettingsOnly = process.env.SYNC_SETTINGS_ONLY === 'true';
      const syncACL          = process.env.SYNC_ACL === 'true';
      const syncAudit        = process.env.SYNC_AUDIT === 'true';
      const syncSavings      = process.env.SYNC_SAVINGS === 'true';
      const syncExpenses     = process.env.SYNC_EXPENSES === 'true';
      const syncCore         = process.env.SYNC_CORE === 'true';

      if (syncSettingsOnly) await ensureSettingsOnly();
      else console.log('⏭️  Skipping settings sync (set SYNC_SETTINGS_ONLY=true for one-off)');

      if (syncACL) await ensureAclTablesAndSeed();
      else console.log('⏭️  Skipping ACL sync (set SYNC_ACL=true for first boot)');

      if (syncAudit) await ensureAuditTables();
      else console.log('⏭️  Skipping Audit sync (set SYNC_AUDIT=true to create/alter audit_logs)');

      if (syncSavings) await ensureSavingsTables();
      else console.log('⏭️  Skipping Savings sync (set SYNC_SAVINGS=true for one-off)');

      if (syncExpenses) await ensureExpensesTables();
      else console.log('⏭️  Skipping Expense sync (set SYNC_EXPENSES=true for one-off)');

      if (syncCore) await ensureCoreTables();
      else console.log('⏭️  Skipping CORE sync (set SYNC_CORE=true to create/alter core tables)');
    }

    // Explicit host helps on Render/containers
    server = app.listen(PORT, '0.0.0.0', () => {
      console.log(`🚀 Server is running on http://0.0.0.0:${PORT}`);
    });
  } catch (err) {
    console.error('❌ Unable to start server:', err);
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
