// backend/src/controllers/settings/systemSettingsController.js
const db = require('../../models');
const { Op } = require('sequelize');
const Setting = db.Setting;

const KEY = 'systemSettings';

// Reasonable defaults if nothing saved yet
const DEFAULTS = {
  currency: 'TZS',           // or 'USD'
  timezone: 'Africa/Dar_es_Salaam',
  language: 'en',
  // add any other global flags here, e.g. dateFormat, numberFormat, etc.
};

/**
 * @desc    Get system settings (single JSON row)
 * @route   GET /api/settings/system-settings
 * @access  Private
 */
const getSystemSettings = async (_req, res) => {
  try {
    const setting = await Setting.findOne({ where: { key: KEY } });
    const value = setting?.value || {};
    // merge with defaults so FE always has a full object
    const merged = { ...DEFAULTS, ...value };
    return res.status(200).json(merged);
  } catch (error) {
    console.error('❌ Error fetching system settings:', error);
    return res.status(500).json({ message: 'Failed to fetch system settings' });
  }
};

/**
 * @desc    Update system settings (single JSON row)
 * @route   PUT /api/settings/system-settings
 * @access  Private
 */
const updateSystemSettings = async (req, res) => {
  try {
    const payload = req.body || {};
    // optional: whitelist incoming fields to avoid junk keys
    const next = {
      currency: payload.currency ?? DEFAULTS.currency,
      timezone: payload.timezone ?? DEFAULTS.timezone,
      language: payload.language ?? DEFAULTS.language,
    };

    const [record] = await Setting.upsert(
      { key: KEY, value: next, updatedBy: req.user?.id || null },
      { returning: true }
    );

    // Some dialects don’t return the updated row as array index 0 in upsert.
    // So re-read to be safe:
    const saved = await Setting.findOne({ where: { key: KEY } });

    return res.status(200).json({
      message: 'System settings updated successfully',
      settings: saved?.value || next,
    });
  } catch (error) {
    console.error('❌ Error updating system settings:', error);
    return res.status(500).json({ message: 'Failed to update system settings' });
  }
};

module.exports = {
  getSystemSettings,
  updateSystemSettings,
};
