'use strict';

const bcrypt = require('bcryptjs');
const { Setting, User } = require('../../models');

/* --------------------------- BILLING (via Setting) -------------------------- */
const BILLING_KEY = 'account.billing';
const BILLING_DEFAULTS = {
  plan: 'free',           // free | pro | enterprise
  currency: 'USD',
  status: 'active',       // active | past_due | cancelled
  nextInvoiceDate: null,  // ISO string
  paymentProvider: null,  // 'stripe' | 'mpesa' | etc
  paymentMethod: null,    // masked card / wallet hint
  invoiceEmails: [],      // array of strings
  billingEmail: null,
  invoiceNotes: '',
  autoRenew: false,
};

exports.getBilling = async (req, res) => {
  try {
    const value = await Setting.get(BILLING_KEY, BILLING_DEFAULTS);
    return res.json({ ok: true, settings: { ...BILLING_DEFAULTS, ...(value || {}) } });
  } catch (err) {
    console.error('getBilling error:', err);
    return res.status(500).json({ ok: false, message: 'Failed to load billing settings' });
  }
};

exports.updateBilling = async (req, res) => {
  try {
    const userId = req.user?.id || null;

    // allow only known keys (ignore random payload)
    const allowed = [
      'plan', 'currency', 'status', 'nextInvoiceDate',
      'paymentProvider', 'paymentMethod',
      'invoiceEmails', 'billingEmail', 'invoiceNotes', 'autoRenew'
    ];
    const patch = {};
    for (const k of allowed) if (k in (req.body || {})) patch[k] = req.body[k];

    const merged = await Setting.merge(BILLING_KEY, patch, userId);
    return res.json({ ok: true, settings: { ...BILLING_DEFAULTS, ...(merged || {}) } });
  } catch (err) {
    console.error('updateBilling error:', err);
    return res.status(500).json({ ok: false, message: 'Failed to update billing settings' });
  }
};

/* ------------------------------- CHANGE PASSWORD ---------------------------- */
exports.changePassword = async (req, res) => {
  try {
    const userId = req.user?.id;
    const { currentPassword, newPassword } = req.body || {};

    if (!userId) return res.status(401).json({ message: 'Unauthorized' });
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ message: 'currentPassword and newPassword are required' });
    }

    // Basic policy (tune later)
    if (String(newPassword).length < 8) {
      return res.status(400).json({ message: 'New password must be at least 8 characters' });
    }

    const user = await User.findByPk(userId);
    if (!user || !user.password_hash) {
      return res.status(400).json({ message: 'User not found or password not set' });
    }

    const ok = await bcrypt.compare(String(currentPassword), String(user.password_hash));
    if (!ok) return res.status(400).json({ message: 'Current password is incorrect' });

    const salt = await bcrypt.genSalt(10);
    const nextHash = await bcrypt.hash(String(newPassword), salt);

    await user.update({ password_hash: nextHash });

    return res.json({ ok: true, message: 'Password updated successfully' });
  } catch (err) {
    console.error('changePassword error:', err);
    return res.status(500).json({ message: 'Failed to change password' });
  }
};
