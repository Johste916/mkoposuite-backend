'use strict';

const { Setting } = require('../../models');

// a single, safe key; if you want multi-tenant later, prefix with tenantId from headers
const KEY = 'account.billing';

const DEFAULTS = {
  plan: 'free',
  currency: 'USD',
  status: 'active',          // active | past_due | cancelled
  nextInvoiceDate: null,     // ISO timestamp
  paymentProvider: null,     // e.g. 'stripe', 'mpesa', etc.
  paymentMethod: null,       // masked card info or wallet hint
  invoiceEmails: [],         // array of strings
};

exports.getBillingSettings = async (req, res) => {
  try {
    const value = await Setting.get(KEY, DEFAULTS);
    return res.json(value || DEFAULTS);
  } catch (err) {
    console.error('getBillingSettings error:', err);
    return res.status(500).json({ error: 'Failed to load billing settings' });
  }
};

exports.updateBillingSettings = async (req, res) => {
  try {
    const userId = req.user?.id || null;
    const patch = req.body && typeof req.body === 'object' ? req.body : {};

    // shallow merge onto existing value
    const current = await Setting.get(KEY, DEFAULTS);
    const next = { ...current, ...patch };

    await Setting.set(KEY, next, userId, userId);
    return res.json(next);
  } catch (err) {
    console.error('updateBillingSettings error:', err);
    return res.status(500).json({ error: 'Failed to update billing settings' });
  }
};
