const db = require('../../models');
const Setting = db.Setting;

const KEY = 'payment_settings';

/**
 * @desc    Get payment settings
 * @route   GET /api/settings/payment-settings
 * @access  Private
 */
exports.getPaymentSettings = async (req, res) => {
  try {
    const setting = await Setting.findOne({ where: { key: KEY } });

    res.status(200).json(setting?.value || {});
  } catch (error) {
    console.error('❌ Error fetching payment settings:', error);
    res.status(500).json({ message: 'Failed to fetch payment settings' });
  }
};

/**
 * @desc    Update payment settings
 * @route   PUT /api/settings/payment-settings
 * @access  Private
 */
exports.updatePaymentSettings = async (req, res) => {
  try {
    const [updated] = await Setting.upsert({
      key: KEY,
      value: req.body
    });

    res.status(200).json({
      message: 'Payment settings updated successfully',
      data: updated.value
    });
  } catch (error) {
    console.error('❌ Error updating payment settings:', error);
    res.status(500).json({ message: 'Failed to update payment settings' });
  }
};
