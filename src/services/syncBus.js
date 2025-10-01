// backend/src/services/syncBus.js
"use strict";

const EventEmitter = require("events");

function safeRequire(mod) {
  try { return require(mod); } catch { return null; }
}
const fetch = safeRequire("node-fetch"); // optional if you set SYNC_WEBHOOK_URL

const bus = new EventEmitter();

const {
  SYNC_WEBHOOK_URL,
  SYNC_WEBHOOK_AUTH,
  SYNC_WEBHOOK_TIMEOUT_MS = "5000",
  SYNC_ENABLE_CONSOLE = "false",
} = process.env;

const queue = [];

function swallow(promise) {
  return Promise.resolve(promise).catch((e) => {
    if (process.env.NODE_ENV !== "production") {
      console.warn("[syncBus] suppressed error:", e?.message || e);
    }
  });
}

async function forwardToWebhook(type, payload) {
  if (!SYNC_WEBHOOK_URL || !fetch) return;
  const body = JSON.stringify({ type, payload, ts: Date.now() });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(SYNC_WEBHOOK_TIMEOUT_MS) || 5000);
  try {
    await fetch(SYNC_WEBHOOK_URL, {
      method: "POST",
      body,
      headers: {
        "content-type": "application/json",
        ...(SYNC_WEBHOOK_AUTH ? { authorization: SYNC_WEBHOOK_AUTH } : {}),
      },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

function emit(type, payload) {
  try {
    if (SYNC_ENABLE_CONSOLE === "true") {
      console.log(`[syncBus] emit: ${type}`, payload);
    }
    bus.emit(type, payload);
    queue.push({ type, payload, ts: Date.now() });
    if (queue.length > 1000) queue.shift();
    swallow(forwardToWebhook(type, payload));
  } catch (e) {
    if (process.env.NODE_ENV !== "production") {
      console.warn("[syncBus] emit failed (swallowed):", e?.message || e);
    }
  }
}

function on(type, handler) {
  bus.on(type, handler);
  return () => bus.off(type, handler);
}

module.exports = {
  emit,
  on,
  publish: emit, // alias
  queue,
};
