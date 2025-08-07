const db = require('../../models');
const Setting = db.Setting;

const DASHBOARD_SETTINGS_KEY = 'dashboardSettings';

/**
 * @desc    Get Dashboard Settings
 * @route   GET /api/settings/dashboard-settings
 * @access  Private
 */
const getDashboardSettings = async (req, res) => {
  try {
    const setting = await Setting.findOne({ where: { key: DASHBOARD_SETTINGS_KEY } });
    res.status(200).json(setting?.value || {});
  } catch (error) {
    console.error('❌ Error fetching dashboard settings:', error);
    res.status(500).json({ message: 'Failed to fetch dashboard settings' });
  }
};

/**
 * @desc    Update Dashboard Settings
 * @route   PUT /api/settings/dashboard-settings
 * @access  Private
 */
const updateDashboardSettings = async (req, res) => {
  try {
    const [updated] = await Setting.upsert({
      key: DASHBOARD_SETTINGS_KEY,
      value: req.body
    });

    res.status(200).json({
      message: 'Dashboard settings updated successfully',
      settings: updated?.value || req.body
    });
  } catch (error) {
    console.error('❌ Error updating dashboard settings:', error);
    res.status(500).json({ message: 'Failed to update dashboard settings' });
  }
};

module.exports = {
  getDashboardSettings,
  updateDashboardSettings
};
