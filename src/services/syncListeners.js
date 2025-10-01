// backend/src/services/syncListeners.js
"use strict";

const Sync = require("./syncBus");

// Examples — add/adjust as you like. Leaving them here means the file loads cleanly.
Sync.on("repayment.created", (evt) => {
  // e.g., refresh dashboards/caches inside the API
  // console.log("[listener] repayment.created", evt);
});

Sync.on("repayment.approved", (evt) => {
  // e.g., bump metrics, recalc summaries, warm caches
  // console.log("[listener] repayment.approved", evt);
});

Sync.on("repayment.voided", (evt) => {
  // e.g., invalidate aggregates
  // console.log("[listener] repayment.voided", evt);
});

// You can export nothing; requiring this file just registers listeners.
