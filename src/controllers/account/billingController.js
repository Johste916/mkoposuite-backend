'use strict';

const { Setting } = require('../../models');

// Single JSON blob stored under this key
const KEY = 'account.billing';

// Default shape – adjust safely, fields are optional on PUT
const DEFAULTS = {
  plan: 'free',              // free | pro | enterprise
  currency: 'USD',
  billingEmail: null,
  invoiceNotes: '',
  autoRenew: false,
};

exports.getBilling = async (req, res) => {
  try {
    const value = await Setting.get(KEY, DEFAULTS);
    return res.json({ ok: true, settings: { ...DEFAULTS, ...(value || {}) } });
  } catch (err) {
    console.error('getBilling error:', err);
    return res.status(500).json({ ok: false, message: 'Failed to load billing settings' });
  }
};

exports.updateBilling = async (req, res) => {
  try {
    // Shallow merge of provided fields (ignore unknowns)
    const allowed = ['plan', 'currency', 'billingEmail', 'invoiceNotes', 'autoRenew'];
    const patch = {};
    for (const k of allowed) if (k in req.body) patch[k] = req.body[k];

    const merged = await Setting.merge(KEY, patch, req.user?.id || null);
    return res.json({ ok: true, settings: { ...DEFAULTS, ...(merged || {}) } });
  } catch (err) {
    console.error('updateBilling error:', err);
    return res.status(500).json({ ok: false, message: 'Failed to update billing settings' });
  }
};
