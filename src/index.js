// backend/src/index.js
const app = require("./app");
const db = require("./models"); // <- bring full db so we can target models
const { sequelize } = db;

// 🛡 Auth middleware (JWT)
const { authenticateUser } = require("./middleware/authMiddleware");

// 📜 Routes
const permissionsRoutes = require("./routes/permissionsRoutes");

// ===== Register API Routes =====
app.use("/api/permissions", authenticateUser, permissionsRoutes);

// 🕒 Nightly penalties job
const cron = require("node-cron");
let penaltiesTask;
try {
  const { runPenaltiesJob } = require("./jobs/penaltiesJob");
  penaltiesTask = cron.schedule("0 2 * * *", async () => {
    console.log("[cron] penalties job started");
    try {
      await runPenaltiesJob();
      console.log("[cron] penalties job finished");
    } catch (e) {
      console.error("[cron] penalties job failed:", e);
    }
  });
} catch (e) {
  console.warn("⚠️ penaltiesJob not wired (optional):", e.message);
}

const PORT = process.env.PORT || 10000;
let server;

(async () => {
  try {
    await sequelize.authenticate();
    console.log("✅ Connected to the database");

    /**
     * 🧩 SCHEMA MANAGEMENT
     * - Never use global sequelize.sync() on a DB managed by migrations.
     * - If you only need the 'settings' table created, enable SYNC_SETTINGS_ONLY=true once.
     */
    const syncSettingsOnly = process.env.SYNC_SETTINGS_ONLY === "true";

    if (syncSettingsOnly) {
      console.log("🔧 Syncing ONLY Setting model to ensure 'settings' table exists…");
      // This will create 'settings' if missing and won't touch other tables.
      await db.Setting.sync(); // no { alter } – keep non-destructive
      console.log("✅ Setting model sync completed");
    } else {
      console.log("⏭  Skipping schema sync (use migrations or set SYNC_SETTINGS_ONLY=true to sync only settings)");
    }

    server = app.listen(PORT, () => {
      console.log(`🚀 Server is running on port ${PORT}`);
    });
  } catch (err) {
    console.error("❌ Unable to connect to the database:", err);
    process.exit(1);
  }
})();

async function shutdown(signal) {
  try {
    console.log(`\n🧹 Received ${signal}. Shutting down gracefully...`);
    if (penaltiesTask?.stop) penaltiesTask.stop();

    if (server) {
      await new Promise((resolve) => server.close(resolve));
      console.log("🛑 HTTP server closed");
    }
    await sequelize.close();
    console.log("🔌 DB connection closed");
    process.exit(0);
  } catch (e) {
    console.error("💥 Error during shutdown:", e);
    process.exit(1);
  }
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("unhandledRejection", (reason) => {
  console.error("⚠️ Unhandled Rejection:", reason);
});
process.on("uncaughtException", (err) => {
  console.error("⚠️ Uncaught Exception:", err);
});
