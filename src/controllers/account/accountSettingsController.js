'use strict';

const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { Setting, User, Branch } = require('../../models');

/* ------------------------------ Multer (avatar) ----------------------------- */
const uploadDir = path.join(process.cwd(), 'uploads', 'avatars');
fs.mkdirSync(uploadDir, { recursive: true });
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || '.png');
    cb(null, `u${req.user?.id || 'x'}_${Date.now()}${ext}`);
  },
});
const avatarUpload = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 }, // 2MB
  fileFilter: (_req, file, cb) => {
    const ok = /image\/(png|jpg|jpeg|webp)/i.test(file.mimetype);
    cb(ok ? null : new Error('Only PNG/JPG/WEBP images allowed'), ok);
  },
}).single('avatar');

/* --------------------------- BILLING (via Setting) -------------------------- */
const BILLING_KEY = 'account.billing';
const BILLING_DEFAULTS = {
  plan: 'free',           // free | pro | enterprise
  currency: 'USD',
  status: 'active',       // active | past_due | cancelled
  nextInvoiceDate: null,  // ISO string
  paymentProvider: null,  // 'stripe' | 'mpesa' | etc
  paymentMethod: null,    // masked card / wallet hint
  invoiceEmails: [],
  billingEmail: null,
  invoiceNotes: '',
  autoRenew: false,
};

exports.getBilling = async (_req, res) => {
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

/* =============================================================================
   PROFILE / PREFERENCES / NOTIFICATIONS / SECURITY
============================================================================= */

/* ------------------------------ GET / UPDATE ME ----------------------------- */
exports.getMe = async (req, res) => {
  try {
    const id = req.user?.id;
    if (!id) return res.status(401).json({ message: 'Unauthorized' });

    const include = [];
    if (Branch) include.push({ model: Branch, as: 'Branch', attributes: ['id', 'name'] });

    const user = await User.findByPk(id, { include });
    if (!user) return res.status(404).json({ message: 'User not found' });

    return res.json({
      ok: true,
      user: {
        id: user.id,
        name: user.name,
        displayName: user.displayName || user.name,
        email: user.email,
        phone: user.phone || '',
        role: user.role || 'user',
        branchId: user.branchId || null,
        timezone: user.timezone || 'Africa/Nairobi',
        locale: user.locale || 'en',
        avatarUrl: user.avatarUrl || null,
        branch: user.Branch ? { id: user.Branch.id, name: user.Branch.name } : null,
        // optional professional attrs (if you add columns later)
        title: user.title || '',
        department: user.department || '',
        employeeCode: user.employeeCode || '',
      },
    });
  } catch (err) {
    console.error('getMe error:', err);
    return res.status(500).json({ message: 'Failed to load account' });
  }
};

exports.updateMe = async (req, res) => {
  try {
    const id = req.user?.id;
    if (!id) return res.status(401).json({ message: 'Unauthorized' });

    const allowed = ['name', 'displayName', 'phone', 'timezone', 'locale', 'branchId'];
    const patch = {};
    for (const k of allowed) if (k in (req.body || {})) patch[k] = req.body[k];

    await User.update(patch, { where: { id } });
    const updated = await User.findByPk(id);
    return res.json({ ok: true, user: updated });
  } catch (err) {
    console.error('updateMe error:', err);
    return res.status(500).json({ message: 'Failed to update profile' });
  }
};

/* -------------------------------- Preferences ------------------------------- */
const prefKey = (id) => `user:${id}:preferences`;
const PREF_DEFAULTS = Object.freeze({
  landingPage: '/dashboard',
  defaultCurrency: 'TZS',
  dateFormat: 'dd/MM/yyyy',
  numberFormat: '1,234.56',
  theme: 'system',        // system | light | dark
  fontScale: 'normal',    // normal | large
  reduceMotion: false,
  colorBlindMode: false,
});

exports.getPreferences = async (req, res) => {
  try {
    const id = req.user?.id;
    const val = await Setting.get(prefKey(id), PREF_DEFAULTS);
    return res.json({ ok: true, preferences: { ...PREF_DEFAULTS, ...(val || {}) } });
  } catch (err) {
    console.error('getPreferences error:', err);
    return res.status(500).json({ message: 'Failed to load preferences' });
  }
};

exports.updatePreferences = async (req, res) => {
  try {
    const id = req.user?.id;
    const allowed = ['landingPage','defaultCurrency','dateFormat','numberFormat','theme','fontScale','reduceMotion','colorBlindMode'];
    const patch = {};
    for (const k of allowed) if (k in (req.body || {})) patch[k] = req.body[k];
    const merged = await Setting.merge(prefKey(id), patch, id);
    return res.json({ ok: true, preferences: { ...PREF_DEFAULTS, ...(merged || {}) } });
  } catch (err) {
    console.error('updatePreferences error:', err);
    return res.status(500).json({ message: 'Failed to update preferences' });
  }
};

/* -------------------------------- Notifications ----------------------------- */
const notifKey = (id) => `user:${id}:notifications`;
const NOTIF_DEFAULTS = Object.freeze({
  channels: { inApp: true, email: true, sms: false },
  events: {
    loanAssigned: true,
    approvalNeeded: true,
    largeRepayment: { enabled: true, threshold: 500000 },
    arrearsDigest: { enabled: true, days: 7, hour: 18 },
    kycAssigned: true,
  },
});

exports.getNotifications = async (req, res) => {
  try {
    const id = req.user?.id;
    const val = await Setting.get(notifKey(id), NOTIF_DEFAULTS);
    return res.json({ ok: true, notifications: { ...NOTIF_DEFAULTS, ...(val || {}) } });
  } catch (err) {
    console.error('getNotifications error:', err);
    return res.status(500).json({ message: 'Failed to load notifications' });
  }
};

exports.updateNotifications = async (req, res) => {
  try {
    const id = req.user?.id;
    const patch = req.body || {};
    const merged = await Setting.merge(notifKey(id), patch, id);
    return res.json({ ok: true, notifications: { ...NOTIF_DEFAULTS, ...(merged || {}) } });
  } catch (err) {
    console.error('updateNotifications error:', err);
    return res.status(500).json({ message: 'Failed to update notifications' });
  }
};

/* ---------------------------------- Sessions --------------------------------
   Simple “active sessions” placeholder using Settings. If you want real device
   tracking, push session objects here on login.
------------------------------------------------------------------------------ */
const sessionsKey = (id) => `user:${id}:sessions`;

exports.getSessions = async (req, res) => {
  try {
    const id = req.user?.id;
    const sessions = (await Setting.get(sessionsKey(id), [])) || [];
    return res.json({ ok: true, sessions });
  } catch (err) {
    console.error('getSessions error:', err);
    return res.status(500).json({ message: 'Failed to load sessions' });
  }
};

exports.revokeAllSessions = async (req, res) => {
  try {
    const id = req.user?.id;
    await Setting.set(sessionsKey(id), [], id);
    // Optional: bump a tokenVersion on User to invalidate JWTs server-side
    return res.json({ ok: true, message: 'Signed out from other devices' });
  } catch (err) {
    console.error('revokeAllSessions error:', err);
    return res.status(500).json({ message: 'Failed to revoke sessions' });
  }
};

/* --------------------------------- Avatar ---------------------------------- */
exports.uploadAvatar = (req, res) => {
  avatarUpload(req, res, async (err) => {
    if (err) return res.status(400).json({ message: err.message || 'Upload failed' });
    try {
      const id = req.user?.id;
      if (!req.file) return res.status(400).json({ message: 'No file' });
      const publicPath = `/uploads/avatars/${req.file.filename}`;
      await User.update({ avatarUrl: publicPath }, { where: { id } });
      return res.json({ ok: true, avatarUrl: publicPath });
    } catch (e) {
      console.error('uploadAvatar error:', e);
      return res.status(500).json({ message: 'Failed to save avatar' });
    }
  });
};
