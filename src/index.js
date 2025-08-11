// src/index.js
const app = require("./app");
const { sequelize } = require("./models");

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
  // Every night at 02:00 server time
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
  // If the job file doesn’t exist yet, don’t crash the app
  console.warn("⚠️ penaltiesJob not wired (optional):", e.message);
}

const PORT = process.env.PORT || 10000;
let server;

(async () => {
  try {
    await sequelize.authenticate();
    console.log("✅ Connected to the database");

    server = app.listen(PORT, () => {
      console.log(`🚀 Server is running on port ${PORT}`);
    });

    // If you use migrations via CLI, keep sync off.
    // if (process.env.NODE_ENV !== 'production') {
    //   await sequelize.sync({ alter: false });
    // }
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
