const db = require('../../models');
const Setting = db.Setting;

// 🎯 Keys for system-level configuration
const SYSTEM_KEYS = ['currency', 'timezone', 'language'];

/**
 * @desc    Get system settings
 * @route   GET /api/settings/system-settings
 * @access  Private
 */
const getSystemSettings = async (req, res) => {
  try {
    const settings = await Setting.findAll({
      where: {
        key: SYSTEM_KEYS
      }
    });

    const response = {};
    SYSTEM_KEYS.forEach(key => {
      const found = settings.find(s => s.key === key);
      response[key] = found ? found.value : null;
    });

    res.status(200).json(response);
  } catch (error) {
    console.error('❌ Error fetching system settings:', error);
    res.status(500).json({ message: 'Failed to fetch system settings', error: error.message });
  }
};

/**
 * @desc    Update system settings
 * @route   PUT /api/settings/system-settings
 * @access  Private
 */
const updateSystemSettings = async (req, res) => {
  try {
    const updates = req.body;

    for (const key of SYSTEM_KEYS) {
      if (Object.prototype.hasOwnProperty.call(updates, key)) {
        await Setting.upsert({
          key,
          value: updates[key]
        });
      }
    }

    res.status(200).json({ message: 'System settings updated successfully' });
  } catch (error) {
    console.error('❌ Error updating system settings:', error);
    res.status(500).json({ message: 'Failed to update system settings', error: error.message });
  }
};

module.exports = {
  getSystemSettings,
  updateSystemSettings
};
