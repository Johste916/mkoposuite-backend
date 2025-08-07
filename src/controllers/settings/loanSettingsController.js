const db = require('../../models');
const Setting = db.Setting;

const KEY = 'loanSettings';

/**
 * @desc    Get loan settings
 * @route   GET /api/settings/loan-settings
 * @access  Private
 */
exports.getLoanSettings = async (req, res) => {
  try {
    const setting = await Setting.findOne({ where: { key: KEY } });

    res.status(200).json(setting?.value || {});
  } catch (error) {
    console.error('❌ Error fetching loan settings:', error);
    res.status(500).json({ message: 'Server error retrieving loan settings' });
  }
};

/**
 * @desc    Update loan settings
 * @route   PUT /api/settings/loan-settings
 * @access  Private
 */
exports.updateLoanSettings = async (req, res) => {
  try {
    const [updated] = await Setting.upsert({
      key: KEY,
      value: req.body
    });

    res.status(200).json({
      message: 'Loan settings updated successfully',
      data: updated.value
    });
  } catch (error) {
    console.error('❌ Error updating loan settings:', error);
    res.status(500).json({ message: 'Server error updating loan settings' });
  }
};
