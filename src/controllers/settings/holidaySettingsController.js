const db = require('../../models');
const Setting = db.Setting;

const HOLIDAY_SETTINGS_KEY = 'holidaySettings';

/**
 * @desc    Get all holiday settings
 * @route   GET /api/settings/holiday-settings
 * @access  Private
 */
const getHolidaySettings = async (req, res) => {
  try {
    const setting = await Setting.findOne({ where: { key: HOLIDAY_SETTINGS_KEY } });
    res.status(200).json(setting?.value || []);
  } catch (error) {
    console.error('❌ Error fetching holiday settings:', error);
    res.status(500).json({ message: 'Failed to fetch holiday settings' });
  }
};

/**
 * @desc    Update holiday settings (array of holidays)
 * @route   PUT /api/settings/holiday-settings
 * @access  Private
 */
const updateHolidaySettings = async (req, res) => {
  try {
    const { holidays } = req.body;

    if (!Array.isArray(holidays)) {
      return res.status(400).json({
        message: 'Invalid format: holidays should be an array'
      });
    }

    const [updated] = await Setting.upsert({
      key: HOLIDAY_SETTINGS_KEY,
      value: holidays
    });

    res.status(200).json({
      message: 'Holiday settings updated successfully',
      settings: updated?.value || holidays
    });
  } catch (error) {
    console.error('❌ Error updating holiday settings:', error);
    res.status(500).json({ message: 'Failed to update holiday settings' });
  }
};

module.exports = {
  getHolidaySettings,
  updateHolidaySettings
};
