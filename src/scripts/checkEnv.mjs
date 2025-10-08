import "dotenv/config";
import process from "node:process";
import http from "node:http";
import { URL } from "node:url";

const REQUIRED = [
  "NODE_ENV",
  "DATABASE_URL",
  "JWT_SECRET",
  "PORT"
];

function fail(msg) {
  console.error(`✖ ${msg}`);
  process.exitCode = 1;
}

(async () => {
  console.log("🔎 Checking environment variables...");
  for (const key of REQUIRED) {
    if (!process.env[key] || process.env[key].trim() === "") {
      fail(`Missing env: ${key}`);
    }
  }

  // ─── DB check (Sequelize) ────────────────────────────────────────────────
  try {
    const { sequelize } = await import("../models/index.js"); // adjust if your Sequelize init is elsewhere
    await sequelize.authenticate({ logging: false });
    console.log("✅ Sequelize DB connection OK");
  } catch (e) {
    fail(`DB connection failed: ${e.message}`);
  }

  // ─── Health check ────────────────────────────────────────────────────────
  const base = `http://localhost:${process.env.PORT || 10000}`;
  const candidates = ["/api/health", "/health", "/_selfcheck"];

  for (const path of candidates) {
    const url = new URL(path, base).toString();
    try {
      await new Promise((resolve, reject) => {
        const req = http.get(url, (res) => {
          res.statusCode < 500 ? resolve() : reject(new Error(`HTTP ${res.statusCode}`));
        });
        req.on("error", reject);
      });
      console.log(`✅ Health check OK (${url})`);
      return; // success, exit early
    } catch {
      // try next
    }
  }

  fail(`Health check failed for all: ${candidates.join(", ")} (base: ${base})`);
})();
