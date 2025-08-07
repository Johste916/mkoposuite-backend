const db = require('../../models');
const Setting = db.Setting;

const KEY = 'loan_sectors';

/**
 * @desc    Get loan sector settings
 * @route   GET /api/settings/loan-sector-settings
 * @access  Private
 */
exports.getLoanSectorSettings = async (req, res) => {
  try {
    const setting = await Setting.findOne({ where: { key: KEY } });
    res.status(200).json(setting ? setting.value : []);
  } catch (error) {
    console.error('❌ Error fetching loan sector settings:', error);
    res.status(500).json({ message: 'Failed to fetch loan sector settings' });
  }
};

/**
 * @desc    Update loan sector settings
 * @route   PUT /api/settings/loan-sector-settings
 * @access  Private
 */
exports.updateLoanSectorSettings = async (req, res) => {
  try {
    const { sectors } = req.body;

    if (!Array.isArray(sectors)) {
      return res.status(400).json({
        message: 'Invalid format. Expected "sectors" to be an array.'
      });
    }

    const [updated] = await Setting.upsert({
      key: KEY,
      value: sectors
    });

    res.status(200).json({
      message: 'Loan sector settings updated successfully',
      data: updated.value
    });
  } catch (error) {
    console.error('❌ Error updating loan sector settings:', error);
    res.status(500).json({ message: 'Failed to update loan sector settings' });
  }
};
