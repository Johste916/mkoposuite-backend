'use strict';

const bcrypt = require('bcryptjs');
const db = require('../../models');
const { Setting, User, Branch } = db;

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

const tenantFromReq = (req) =>
  req.tenant?.id || req.headers['x-tenant-id'] || req.user?.tenantId || null;

exports.getBilling = async (req, res) => {
  try {
    const tenantId = tenantFromReq(req);

    // Prefer tenant-aware Setting.get(key, defaults, tenantId), fall back gracefully
    let value;
    try {
      value = await Setting.get(BILLING_KEY, BILLING_DEFAULTS, tenantId);
    } catch {
      value = await Setting.get(BILLING_KEY, BILLING_DEFAULTS);
    }

    return res.json({ ok: true, settings: { ...BILLING_DEFAULTS, ...(value || {}) } });
  } catch (err) {
    console.error('getBilling error:', err);
    return res.status(500).json({ ok: false, message: 'Failed to load billing settings' });
  }
};

exports.updateBilling = async (req, res) => {
  try {
    const userId = req.user?.id || null;
    const tenantId = tenantFromReq(req);

    // allow only known keys (ignore random payload)
    const allowed = [
      'plan', 'currency', 'status', 'nextInvoiceDate',
      'paymentProvider', 'paymentMethod',
      'invoiceEmails', 'billingEmail', 'invoiceNotes', 'autoRenew'
    ];
    const patch = {};
    for (const k of allowed) if (k in (req.body || {})) patch[k] = req.body[k];

    let merged;
    try {
      merged = await Setting.merge(BILLING_KEY, patch, userId, tenantId);
    } catch {
      merged = await Setting.merge(BILLING_KEY, patch, userId);
    }

    return res.json({ ok: true, settings: { ...BILLING_DEFAULTS, ...(merged || {}) } });
  } catch (err) {
    console.error('updateBilling error:', err);
    return res.status(500).json({ ok: false, message: 'Failed to update billing settings' });
  }
};

/* ------------------------------ PROFILE (new) ------------------------------- */
/** GET /account/profile — fetch current user's profile (plus branch name when available) */
exports.getProfile = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });

    const include = [];
    if (Branch) include.push({ model: Branch, as: 'branch', attributes: ['id', 'name'] });

    const user = await User.findByPk(userId, {
      attributes: ['id', 'name', 'email', 'phone', 'avatarUrl', 'branchId', ...(User.rawAttributes.tenantId ? ['tenantId'] : [])],
      include,
    });
    if (!user) return res.status(404).json({ message: 'User not found' });

    return res.json({ ok: true, user });
  } catch (err) {
    console.error('getProfile error:', err);
    return res.status(500).json({ message: 'Failed to load profile' });
  }
};

/** PATCH /account/profile — update name/phone/avatarUrl/branchId */
exports.updateProfile = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });

    const { name, phone, avatarUrl, branchId } = req.body || {};
    const patch = {};
    if (typeof name === 'string') patch.name = name.trim();
    if (typeof phone === 'string') patch.phone = phone.trim();
    if (typeof avatarUrl === 'string') patch.avatarUrl = avatarUrl.trim();

    // branch change allowed only if the column exists
    if (branchId != null && User.rawAttributes.branchId) {
      if (!Branch) return res.status(400).json({ message: 'Branch not available' });
      const branch = await Branch.findByPk(branchId);
      if (!branch) return res.status(400).json({ message: 'Invalid branchId' });
      patch.branchId = branch.id;
    }

    const user = await User.findByPk(userId);
    if (!user) return res.status(404).json({ message: 'User not found' });

    await user.update(patch);

    return res.json({ ok: true, message: 'Profile updated', user });
  } catch (err) {
    console.error('updateProfile error:', err);
    return res.status(500).json({ message: 'Failed to update profile' });
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
