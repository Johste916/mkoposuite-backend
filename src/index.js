// src/index.js
const app = require('./app');
const { sequelize } = require('./models');

const PORT = process.env.PORT || 10000;
let server;

(async () => {
  try {
    await sequelize.authenticate();
    console.log('✅ Connected to the database');

    server = app.listen(PORT, () => {
      console.log(`🚀 Server is running on port ${PORT}`);
    });

    // If you use migrations via CLI, do NOT sync here.
    // If you want an optional safety sync for local only:
    // if (process.env.NODE_ENV !== 'production') {
    //   await sequelize.sync({ alter: false });
    // }

  } catch (err) {
    console.error('❌ Unable to connect to the database:', err);
    process.exit(1);
  }
})();

async function shutdown(signal) {
  try {
    console.log(`\n🧹 Received ${signal}. Shutting down gracefully...`);
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
process.on('SIGINT', () => shutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  console.error('⚠️ Unhandled Rejection:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('⚠️ Uncaught Exception:', err);
});
