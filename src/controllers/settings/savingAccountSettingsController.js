const db = require('../../models');
const Setting = db.Setting;

const SETTING_KEY = 'savingAccountSettings';

/**
 * @desc    Get Saving Account Settings
 * @route   GET /api/settings/saving-settings
 * @access  Private
 */
exports.getSavingAccountSettings = async (req, res) => {
  try {
    const setting = await Setting.findOne({
      where: { key: SETTING_KEY }
    });

    const defaultSettings = {
      minOpeningBalance: 0,
      interestRate: 0,
      allowOverdraft: false,
      overdraftLimit: 0
    };

    res.status(200).json(setting?.value || defaultSettings);
  } catch (error) {
    console.error('❌ Error fetching saving account settings:', error);
    res.status(500).json({
      message: 'Failed to retrieve saving account settings',
      error: error.message
    });
  }
};

/**
 * @desc    Update Saving Account Settings
 * @route   PUT /api/settings/saving-settings
 * @access  Private
 */
exports.updateSavingAccountSettings = async (req, res) => {
  try {
    const {
      minOpeningBalance = 0,
      interestRate = 0,
      allowOverdraft = false,
      overdraftLimit = 0
    } = req.body;

    const [updated] = await Setting.upsert({
      key: SETTING_KEY,
      value: {
        minOpeningBalance,
        interestRate,
        allowOverdraft,
        overdraftLimit
      }
    });

    res.status(200).json({
      message: 'Saving account settings updated successfully',
      settings: {
        minOpeningBalance,
        interestRate,
        allowOverdraft,
        overdraftLimit
      }
    });
  } catch (error) {
    console.error('❌ Error updating saving account settings:', error);
    res.status(500).json({
      message: 'Failed to update saving account settings',
      error: error.message
    });
  }
};
