const db = require('../../models');
const Setting = db.Setting;

const INCOME_SOURCES_KEY = 'incomeSourceSettings';

/**
 * @desc    Get income source settings
 * @route   GET /api/settings/income-source-settings
 * @access  Private
 */
const getIncomeSourceSettings = async (req, res) => {
  try {
    const setting = await Setting.findOne({ where: { key: INCOME_SOURCES_KEY } });
    res.status(200).json(setting?.value || []);
  } catch (error) {
    console.error('❌ Error fetching income source settings:', error);
    res.status(500).json({ message: 'Failed to fetch income source settings' });
  }
};

/**
 * @desc    Update income source settings
 * @route   PUT /api/settings/income-source-settings
 * @access  Private
 */
const updateIncomeSourceSettings = async (req, res) => {
  try {
    const { sources } = req.body;

    if (!Array.isArray(sources)) {
      return res.status(400).json({ message: 'Invalid format. Expected an array of sources.' });
    }

    const [updated] = await Setting.upsert({
      key: INCOME_SOURCES_KEY,
      value: sources
    });

    res.status(200).json({
      message: 'Income source settings updated successfully',
      settings: updated?.value || sources
    });
  } catch (error) {
    console.error('❌ Error updating income source settings:', error);
    res.status(500).json({ message: 'Failed to update income source settings' });
  }
};

module.exports = {
  getIncomeSourceSettings,
  updateIncomeSourceSettings
};
