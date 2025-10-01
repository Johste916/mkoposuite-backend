// services/syncListeners.js
'use strict';

const { bus, EVENTS } = require('./syncBus');

// Optionally pull models for side effects like denormalized totals
let models;
try { models = require('../models'); } catch { try { models = require('../../models'); } catch {} }

function log(event, data) {
  const idPart = data?.id ? ` id=${data.id}` : '';
  console.log(`[sync] ${event}${idPart}`);
}

/** Example listeners — keep them lightweight and idempotent */
bus.on(EVENTS.BORROWER_UPDATED, async (payload) => {
  log(EVENTS.BORROWER_UPDATED, payload);
  // e.g., rebuild borrower search index, refresh aggregates, etc.
});

bus.on(EVENTS.LOAN_UPDATED, async (payload) => {
  log(EVENTS.LOAN_UPDATED, payload);
  // e.g., recompute cached outstanding if needed
});

bus.on(EVENTS.REPAYMENT_POSTED, async (payload) => {
  log(EVENTS.REPAYMENT_POSTED, payload);
  // e.g., enqueue receipt email/SMS, refresh dashboards
});

bus.on(EVENTS.REPAYMENT_VOIDED, async (payload) => {
  log(EVENTS.REPAYMENT_VOIDED, payload);
});

module.exports = bus; // not strictly required, but handy if you want to import the emitter
