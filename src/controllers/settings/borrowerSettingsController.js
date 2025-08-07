const db = require('../../models');
const Setting = db.Setting;

const BORROWER_SETTINGS_KEY = 'borrowerSettings';

/**
 * @desc    Get Borrower Settings
 * @route   GET /api/settings/borrower-settings
 * @access  Private
 */
const getBorrowerSettings = async (req, res) => {
  try {
    const setting = await Setting.findOne({ where: { key: BORROWER_SETTINGS_KEY } });
    res.status(200).json(setting ? setting.value : {});
  } catch (error) {
    console.error('❌ Error fetching borrower settings:', error);
    res.status(500).json({ message: 'Failed to fetch borrower settings' });
  }
};

/**
 * @desc    Update Borrower Settings
 * @route   PUT /api/settings/borrower-settings
 * @access  Private
 */
const updateBorrowerSettings = async (req, res) => {
  const {
    minAge = 18,
    maxAge = 65,
    allowMultipleLoans = false,
    requireGuarantors = true,
    requireIDVerification = true,
    defaultEmploymentStatus = 'unemployed',
  } = req.body;

  const value = {
    minAge,
    maxAge,
    allowMultipleLoans,
    requireGuarantors,
    requireIDVerification,
    defaultEmploymentStatus,
  };

  try {
    const [setting, created] = await Setting.upsert(
      { key: BORROWER_SETTINGS_KEY, value },
      { returning: true }
    );

    res.status(200).json({
      message: 'Borrower settings updated successfully',
      settings: setting.value,
    });
  } catch (error) {
    console.error('❌ Error updating borrower settings:', error);
    res.status(500).json({ message: 'Failed to update borrower settings' });
  }
};

module.exports = {
  getBorrowerSettings,
  updateBorrowerSettings,
};
