const db = require('../../models');
const Setting = db.Setting;

const BULK_SMS_KEY = 'bulkSmsSettings';

/**
 * @desc    Get Bulk SMS Settings
 * @route   GET /api/settings/bulk-sms-settings
 * @access  Private
 */
const getBulkSmsSettings = async (req, res) => {
  try {
    const setting = await Setting.findOne({ where: { key: BULK_SMS_KEY } });

    res.status(200).json(setting?.value || {});
  } catch (err) {
    console.error('❌ Error fetching Bulk SMS settings:', err);
    res.status(500).json({
      message: 'Failed to fetch Bulk SMS settings',
      error: err.message
    });
  }
};

/**
 * @desc    Update Bulk SMS Settings
 * @route   PUT /api/settings/bulk-sms-settings
 * @access  Private
 */
const updateBulkSmsSettings = async (req, res) => {
  try {
    const {
      gatewayUrl = '',
      senderId = '',
      apiKey = '',
      enableSmsNotifications = false,
      messageTemplate = ''
    } = req.body;

    const [updated] = await Setting.upsert({
      key: BULK_SMS_KEY,
      value: {
        gatewayUrl,
        senderId,
        apiKey,
        enableSmsNotifications,
        messageTemplate
      }
    });

    res.status(200).json({
      message: 'Bulk SMS settings updated successfully',
      settings: updated?.value || req.body
    });
  } catch (err) {
    console.error('❌ Error updating Bulk SMS settings:', err);
    res.status(500).json({
      message: 'Failed to update Bulk SMS settings',
      error: err.message
    });
  }
};

module.exports = {
  getBulkSmsSettings,
  updateBulkSmsSettings
};
