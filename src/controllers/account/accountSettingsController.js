'use strict';

const bcrypt = require('bcryptjs');
const { Setting, sequelize } = require('../../models');
const { QueryTypes } = require('sequelize');

/* ------------------------ BILLING (per-tenant) ------------------------ */
const BILLING_KEY = (tenantId = 'default') => `tenant:${tenantId || 'default'}:billing`;

const BILLING_DEFAULTS = {
  plan: 'free',               // free | starter | pro
  status: 'active',           // active | trialing | past_due | canceled
  currency: 'USD',
  billingEmail: null,
  nextInvoiceAt: null,        // ISO timestamp or null
  autoRenew: false,
  invoiceNotes: '',
  invoiceEmails: [],          // array of strings
};

exports.getBilling = async (req, res) => {
  try {
    const tenantId = req.headers['x-tenant-id'] || 'default';
    const value = await Setting.get(BILLING_KEY(tenantId), BILLING_DEFAULTS);
    return res.json({ tenantId, ...BILLING_DEFAULTS, ...(value || {}) });
  } catch (err) {
    console.error('getBilling error:', err);
    return res.status(500).json({ message: 'Failed to load billing settings' });
  }
};

exports.updateBilling = async (req, res) => {
  try {
    const tenantId = req.headers['x-tenant-id'] || 'default';

    // Whitelist fields only
    const allowed = [
      'plan', 'status', 'currency', 'billingEmail',
      'nextInvoiceAt', 'autoRenew', 'invoiceNotes', 'invoiceEmails'
    ];
    const patch = {};
    for (const k of allowed) if (k in (req.body || {})) patch[k] = req.body[k];

    const merged = await Setting.merge(BILLING_KEY(tenantId), patch, req.user?.id || req.user?.userId || null);
    return res.json({ tenantId, ...BILLING_DEFAULTS, ...(merged || {}) });
  } catch (err) {
    console.error('updateBilling error:', err);
    return res.status(500).json({ message: 'Failed to update billing settings' });
  }
};

/* ------------------------ CHANGE PASSWORD ------------------------ */
exports.changePassword = async (req, res) => {
  try {
    const userId = req.user?.id || req.user?.userId;
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });

    const { oldPassword, newPassword } = req.body || {};
    if (!oldPassword || !newPassword) {
      return res.status(400).json({ message: 'Old and new passwords are required' });
    }
    if (String(newPassword).length < 8) {
      return res.status(400).json({ message: 'New password must be at least 8 characters' });
    }

    const rows = await sequelize.query(
      `SELECT id, password_hash FROM "Users" WHERE id = :id LIMIT 1`,
      { replacements: { id: userId }, type: QueryTypes.SELECT }
    );
    const user = rows[0];
    if (!user) return res.status(404).json({ message: 'User not found' });

    const ok = await bcrypt.compare(String(oldPassword), String(user.password_hash || ''));
    if (!ok) return res.status(401).json({ message: 'Old password is incorrect' });

    const newHash = await bcrypt.hash(String(newPassword), 10);
    await sequelize.query(
      `UPDATE "Users"
         SET password_hash = :hash, "updatedAt" = NOW()
       WHERE id = :id`,
      { replacements: { id: userId, hash: newHash }, type: QueryTypes.UPDATE }
    );

    return res.json({ message: 'Password updated successfully' });
  } catch (err) {
    console.error('changePassword error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};
