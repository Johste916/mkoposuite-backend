// backend/src/controllers/settings/userManagementController.js
const db = require('../../models');
const Setting = db.Setting;

const KEY = 'userManagementSettings';

const DEFAULTS = {
  defaultRole: 'user',              // 'user' | 'manager' | 'admin' ... (your roles)
  roleApprovalRequired: false,      // require admin approval when role changes
  allowMultipleBranchAccess: false, // can a user belong to multiple branches
  accountLockThreshold: 5,          // failed logins before lock
};

/**
 * @desc    Get user management settings
 * @route   GET /api/settings/user-management
 * @access  Private
 */
const getUsers = async (_req, res) => {
  try {
    const row = await Setting.findOne({ where: { key: KEY } });
    const value = { ...DEFAULTS, ...(row?.value || {}) };
    res.status(200).json(value);
  } catch (error) {
    console.error('❌ Error fetching user management settings:', error);
    res.status(500).json({ message: 'Failed to fetch user management settings', error: error.message });
  }
};

/**
 * @desc    Update user management settings (partial merge)
 * @route   PUT /api/settings/user-management
 * @access  Private
 */
const updateUser = async (req, res) => {
  try {
    // whitelist only known fields
    const payload = {};
    if (typeof req.body.defaultRole !== 'undefined') payload.defaultRole = String(req.body.defaultRole);
    if (typeof req.body.roleApprovalRequired !== 'undefined') payload.roleApprovalRequired = !!req.body.roleApprovalRequired;
    if (typeof req.body.allowMultipleBranchAccess !== 'undefined') payload.allowMultipleBranchAccess = !!req.body.allowMultipleBranchAccess;
    if (typeof req.body.accountLockThreshold !== 'undefined') {
      const n = Number(req.body.accountLockThreshold);
      payload.accountLockThreshold = Number.isFinite(n) && n >= 0 ? n : DEFAULTS.accountLockThreshold;
    }

    const existing = await Setting.findOne({ where: { key: KEY } });
    const curr = existing?.value || {};
    const next = { ...DEFAULTS, ...curr, ...payload };

    await Setting.upsert({
      key: KEY,
      value: next,
      updatedBy: req.user?.id || null,
    });

    res.status(200).json({ message: 'User management settings updated successfully', settings: next });
  } catch (error) {
    console.error('❌ Error updating user management settings:', error);
    res.status(500).json({ message: 'Failed to update user management settings', error: error.message });
  }
};

module.exports = {
  getUsers,
  updateUser,
};
