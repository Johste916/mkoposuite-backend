// services/syncBus.js
'use strict';

const { EventEmitter } = require('events');

/**
 * A tiny in-process event bus.
 * Export a singleton emitter and a helper to emit with safe defaults.
 */
class SyncBus extends EventEmitter {
  emitSafe(event, payload = {}) {
    try {
      super.emit(event, payload);
    } catch (e) {
      console.error(`[syncBus] listener error for "${event}":`, e);
    }
  }
}

const bus = new SyncBus();

// Common event names (optional export for typing/discovery)
const EVENTS = {
  BORROWER_CREATED: 'borrower.created',
  BORROWER_UPDATED: 'borrower.updated',
  LOAN_CREATED:     'loan.created',
  LOAN_UPDATED:     'loan.updated',
  REPAYMENT_POSTED: 'repayment.posted',
  REPAYMENT_VOIDED: 'repayment.voided',
  SAVINGS_TXN:      'savings.txn',
  REPORT_REQUESTED: 'report.requested',
};

module.exports = { bus, EVENTS };
